#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <TMCStepper.h>
#include <ESP32Servo.h>
#include <math.h>
#include <limits.h>
#include <deque>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

constexpr char WIFI_SSID[] = "Pataflafla";
constexpr char WIFI_PASS[] = "(l)Rlr(r)L(l)R";

constexpr float R_SENSE = 0.11f;

constexpr uint8_t DRIVER_ADDR_LEFT = 0b00;
constexpr uint8_t DRIVER_ADDR_RIGHT = 0b01;

constexpr uint32_t DEFAULT_SPEED = 1200;   // steps per second
constexpr uint16_t DEFAULT_CURRENT = 800;  // milliamps
constexpr uint32_t MAX_SPEED = 5000;       // guard rail for mechanics
constexpr uint8_t MIN_PULSE_US = 2;        // high/low pulse width
constexpr uint16_t MAX_QUEUE_SIZE = 10000; // prevent memory exhaustion

constexpr float BOARD_WIDTH_MM = 900.0f;
constexpr float BOARD_HEIGHT_MM = 550.0f;
constexpr float CONNECTION_TO_PEN_DISTANCE = 29.0f;
constexpr uint16_t STEPS_PER_REV = 200;
constexpr uint8_t MICROSTEPS = 8;
constexpr float SPOOL_DIAMETER_MM = 12.0f;
constexpr float SPOOL_CIRCUMFERENCE_MM = SPOOL_DIAMETER_MM * PI;
constexpr float STEPS_PER_MM = (STEPS_PER_REV * MICROSTEPS) / SPOOL_CIRCUMFERENCE_MM;

constexpr int PEN_SERVO_PIN = 19;
constexpr int PEN_UP_ANGLE = 40;     // adjust for your linkage
constexpr int PEN_DOWN_ANGLE = 105;  // adjust for your linkage
constexpr uint16_t PEN_SERVO_SETTLE_MS = 200;

struct MachineState {
  float x_mm;
  float y_mm;
  float left_len_mm;
  float right_len_mm;
  int64_t left_steps;
  int64_t right_steps;
  bool pen_down;
  bool initialized;
};

struct QueuedPoint {
  float x, y;
  bool penDown;
  uint32_t speed;
};

struct MotorConfig {
  const char* id;
  uint8_t enablePin;
  uint8_t dirPin;
  uint8_t stepPin;
  TMC2209Stepper* driver;
  volatile bool busy;
};

HardwareSerial driverSerial(2);  // UART2 on pins RX=16, TX=17
TMC2209Stepper driverLeft(&driverSerial, R_SENSE, DRIVER_ADDR_LEFT);
TMC2209Stepper driverRight(&driverSerial, R_SENSE, DRIVER_ADDR_RIGHT);

MotorConfig motors[] = {
  {"left", 14, 13, 12, &driverLeft, false},
  {"right", 27, 26, 25, &driverRight, false}
};

WebServer server(80);

MachineState machine = {BOARD_WIDTH_MM/2, BOARD_HEIGHT_MM/2, 0.0f, 0.0f, 0, 0, false, false};

std::deque<QueuedPoint> pointQueue;
volatile bool isExecuting = false;
SemaphoreHandle_t queueMutex = nullptr;

static inline void lockQueue() {
  if (queueMutex) {
    xSemaphoreTake(queueMutex, portMAX_DELAY);
  }
}

static inline void unlockQueue() {
  if (queueMutex) {
    xSemaphoreGive(queueMutex);
  }
}

Servo penServo;
bool servoPenDown = false;
volatile bool cancelRequested = false;

void applyPenState(bool down);

void emergencyStop() {
  for (auto& motor : motors) {
    enableMotor(motor, false);
    motor.busy = false;
  }
  applyPenState(false);
  machine.pen_down = false;
}

void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

void handleCorsPreflight() {
  addCorsHeaders();
  server.send(204);
}

MotorConfig* findMotor(const char* id) {
  for (auto& motor : motors) {
    if (strcmp(motor.id, id) == 0) {
      return &motor;
    }
  }
  return nullptr;
}

uint32_t clampSpeed(uint32_t speed) {
  if (speed == 0) {
    speed = DEFAULT_SPEED;
  }
  return min(speed, MAX_SPEED);
}

void setupDriver(TMC2209Stepper& driver) {
  driver.begin();
  driver.toff(5);
  driver.rms_current(DEFAULT_CURRENT);
  driver.en_spreadCycle(false);
  driver.pdn_disable(true);
  driver.I_scale_analog(false);
}

void enableMotor(MotorConfig& motor, bool enable) {
  digitalWrite(motor.enablePin, enable ? LOW : HIGH);  // LOW enables driver
}

void performSteps(MotorConfig& motor, int32_t steps, uint32_t speed) {
  motor.busy = true;

  const bool forward = steps > 0;
  const uint32_t totalSteps = static_cast<uint32_t>(abs(steps));
  const uint32_t targetSpeed = clampSpeed(speed);
  const uint32_t stepDelayUs = max(1000000UL / targetSpeed, static_cast<uint32_t>(MIN_PULSE_US * 2));

  enableMotor(motor, true);
  digitalWrite(motor.dirPin, forward ? HIGH : LOW);

  for (uint32_t i = 0; i < totalSteps; ++i) {
    if (cancelRequested) {
      enableMotor(motor, false);
      motor.busy = false;
      return;
    }
    digitalWrite(motor.stepPin, HIGH);
    delayMicroseconds(MIN_PULSE_US);
    digitalWrite(motor.stepPin, LOW);
    delayMicroseconds(stepDelayUs - MIN_PULSE_US);
    server.handleClient();
  }

  motor.busy = false;
}

void pulsePin(uint8_t pin) {
  digitalWrite(pin, HIGH);
  delayMicroseconds(MIN_PULSE_US);
  digitalWrite(pin, LOW);
}

bool runDualMotorSteps(int32_t leftDelta, int32_t rightDelta, uint32_t speed) {
  MotorConfig& left = motors[0];
  MotorConfig& right = motors[1];

  const uint32_t leftSteps = static_cast<uint32_t>(abs(leftDelta));
  const uint32_t rightSteps = static_cast<uint32_t>(abs(rightDelta));
  const uint32_t maxSteps = max(leftSteps, rightSteps);
  if (maxSteps == 0) {
    return true;
  }

  const uint32_t targetSpeed = clampSpeed(speed);
  const uint32_t stepDelayUs = max(1000000UL / targetSpeed, static_cast<uint32_t>(MIN_PULSE_US * 4));

  left.busy = true;
  right.busy = true;

  enableMotor(left, true);
  enableMotor(right, true);

  digitalWrite(left.dirPin, leftDelta >= 0 ? HIGH : LOW);
  digitalWrite(right.dirPin, rightDelta >= 0 ? HIGH : LOW);

  uint32_t accLeft = 0;
  uint32_t accRight = 0;

  for (uint32_t i = 0; i < maxSteps; ++i) {
    if (cancelRequested) {
      emergencyStop();
      left.busy = false;
      right.busy = false;
      return false;
    }

    accLeft += leftSteps;
    accRight += rightSteps;

    if (accLeft >= maxSteps) {
      accLeft -= maxSteps;
      pulsePin(left.stepPin);
    }

    if (accRight >= maxSteps) {
      accRight -= maxSteps;
      pulsePin(right.stepPin);
    }

    delayMicroseconds(stepDelayUs);
    server.handleClient();
  }

  left.busy = false;
  right.busy = false;

  if (cancelRequested) {
    emergencyStop();
    return false;
  }

  return true;
}

void applyPenState(bool down) {
  if (!penServo.attached()) {
    return;
  }
  if (servoPenDown == down) {
    return;
  }
  const int angle = down ? PEN_DOWN_ANGLE : PEN_UP_ANGLE;
  penServo.write(angle);
  delay(PEN_SERVO_SETTLE_MS);
  servoPenDown = down;
}

bool computeStringLengths(float x, float y, float& leftLen, float& rightLen) {
  if (x < 0 || y < 0) {
    return false;
  }
  // Compute position of points on Gondala where the belts connect
  float leftConnection_x = x-CONNECTION_TO_PEN_DISTANCE;
  float rightConnection_x = x+CONNECTION_TO_PEN_DISTANCE;

  // motors mounted at (0,0) and (board width, 0)
  leftLen = sqrtf(leftConnection_x * leftConnection_x + y * y);
  const float dx = BOARD_WIDTH_MM - rightConnection_x;
  rightLen = sqrtf(dx * dx + y * y);
  if (!(isfinite(leftLen) && isfinite(rightLen))) {
    return false;
  }
  return true;
}

bool moveToXY(float x, float y, bool penDown, uint32_t speed) {
  float targetLeftLen = 0.0f;
  float targetRightLen = 0.0f;
  if (!computeStringLengths(x, y, targetLeftLen, targetRightLen)) {  
    Serial.printf("[MOVE] Invalid target (%.2f, %.2f) -> string lengths NaN\n", x, y);
    return false;
  }

  const int64_t targetLeftSteps = llround(static_cast<double>(targetLeftLen) * static_cast<double>(STEPS_PER_MM));
  const int64_t targetRightSteps = llround(static_cast<double>(targetRightLen) * static_cast<double>(STEPS_PER_MM));

  const int64_t leftDelta = targetLeftSteps - machine.left_steps;
  const int64_t rightDelta = targetRightSteps - machine.right_steps;

  if (llabs(leftDelta) > INT32_MAX || llabs(rightDelta) > INT32_MAX) {
    Serial.printf("[MOVE] Delta overflow left=%lld right=%lld\n",
                  static_cast<long long>(leftDelta),
                  static_cast<long long>(rightDelta));
    return false;
  }

  static uint32_t moveLogCounter = 0;
  moveLogCounter++;
  if (moveLogCounter <= 5 || moveLogCounter % 500 == 0) {
    Serial.printf("[MOVE] target=(%.2f, %.2f) pen=%s speed=%lu | leftDelta=%ld rightDelta=%ld\n",
                  x,
                  y,
                  penDown ? "down" : "up",
                  static_cast<unsigned long>(speed),
                  static_cast<long>(leftDelta),
                  static_cast<long>(rightDelta));
  }

  applyPenState(penDown);

  if (!runDualMotorSteps(static_cast<int32_t>(leftDelta), static_cast<int32_t>(rightDelta), speed)) {
    return false;
  }

  machine.left_steps = targetLeftSteps;
  machine.right_steps = targetRightSteps;
  machine.left_len_mm = targetLeftLen;
  machine.right_len_mm = targetRightLen;
  machine.x_mm = x;
  machine.y_mm = y;
  machine.pen_down = penDown;

  return true;
}

void handleMove() {
  addCorsHeaders();
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"error\":\"Use POST\"}");
    return;
  }

  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Missing body\"}");
    return;
  }

  StaticJsonDocument<256> doc;
  const DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) {
    server.send(400, "application/json", "{\"error\":\"Bad JSON\"}");
    return;
  }

  const char* motorId = doc["motor"] | "left";
  const int32_t steps = doc["steps"] | 0;
  const uint32_t speed = doc["speed"] | DEFAULT_SPEED;

  MotorConfig* motor = findMotor(motorId);
  if (!motor) {
    server.send(404, "application/json", "{\"error\":\"Unknown motor\"}");
    return;
  }

  if (motor->busy) {
    server.send(409, "application/json", "{\"error\":\"Motor busy\"}");
    return;
  }

  if (steps == 0) {
    server.send(200, "application/json", "{\"status\":\"noop\"}");
    return;
  }

  performSteps(*motor, steps, speed);

  StaticJsonDocument<128> response;
  response["status"] = "ok";
  response["motor"] = motorId;
  response["steps"] = steps;
  response["speed"] = clampSpeed(speed);

  String payload;
  serializeJson(response, payload);
  server.send(200, "application/json", payload);
}

void handleStatus() {
  addCorsHeaders();
  StaticJsonDocument<512> doc;
  doc["wifi"]["ip"] = WiFi.localIP().toString();

  JsonArray motorsArray = doc.createNestedArray("motors");
  for (auto& motor : motors) {
    JsonObject entry = motorsArray.createNestedObject();
    entry["id"] = motor.id;
    entry["busy"] = motor.busy;
  }

  JsonObject state = doc.createNestedObject("state");
  state["initialized"] = machine.initialized;
  state["x_mm"] = machine.x_mm;
  state["y_mm"] = machine.y_mm;
  state["penDown"] = machine.pen_down;

  JsonObject lengths = state.createNestedObject("lengths_mm");
  lengths["left"] = machine.left_len_mm;
  lengths["right"] = machine.right_len_mm;

  JsonObject steps = state.createNestedObject("steps");
  steps["left"] = machine.left_steps;
  steps["right"] = machine.right_steps;

  // Add queue information
  size_t queueSizeSnapshot = 0;
  bool executingSnapshot = false;
  lockQueue();
  queueSizeSnapshot = pointQueue.size();
  executingSnapshot = isExecuting;
  unlockQueue();

  JsonObject queueInfo = doc.createNestedObject("queue");
  queueInfo["size"] = queueSizeSnapshot;
  queueInfo["isExecuting"] = executingSnapshot;

  String payload;
  serializeJson(doc, payload);
  server.send(200, "application/json", payload);
}

void handleRoot() {
  addCorsHeaders();
  server.send(200, "text/plain", "ESP32 motion controller online.");
}

void handlePen() {
  addCorsHeaders();
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"error\":\"Use POST\"}");
    return;
  }

  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Missing body\"}");
    return;
  }

  StaticJsonDocument<128> doc;
  const DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) {
    server.send(400, "application/json", "{\"error\":\"Bad JSON\"}");
    return;
  }

  const bool penDown = doc["penDown"] | false;
  applyPenState(penDown);
  machine.pen_down = penDown;

  StaticJsonDocument<128> response;
  response["status"] = "ok";
  response["penDown"] = penDown;

  String payload;
  serializeJson(response, payload);
  server.send(200, "application/json", payload);
}

void handleCancel() {
  addCorsHeaders();
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"error\":\"Use POST\"}");
    return;
  }

  cancelRequested = true;
  emergencyStop();

  // Clear the queue and stop execution
  lockQueue();
  pointQueue.clear();
  isExecuting = false;
  unlockQueue();

  StaticJsonDocument<128> response;
  response["status"] = "ok";
  response["cancelled"] = true;
  response["queueCleared"] = true;

  String payload;
  serializeJson(response, payload);
  server.send(200, "application/json", payload);
}

void handlePath() {
  addCorsHeaders();
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"error\":\"Use POST\"}");
    return;
  }

  Serial.println(F("[PATH] Incoming path request"));

  if (!server.hasArg("plain")) {
    Serial.println(F("[PATH] Missing body payload"));
    server.send(400, "application/json", "{\"error\":\"Missing body\"}");
    return;
  }

  DynamicJsonDocument doc(16384);
  const DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) {
    Serial.printf("[PATH] JSON parse failed: %s\n", err.c_str());
    server.send(400, "application/json", "{\"error\":\"Bad JSON\"}");
    return;
  }

  const bool reset = doc["reset"] | false;
  const uint32_t defaultSpeed = doc["speed"] | DEFAULT_SPEED;

  Serial.printf("[PATH] reset=%s, initialized=%s, defaultSpeed=%lu\n",
                reset ? "true" : "false",
                machine.initialized ? "true" : "false",
                static_cast<unsigned long>(defaultSpeed));

  cancelRequested = false;

  if (reset) {
    lockQueue();
    pointQueue.clear();
    isExecuting = false;
    unlockQueue();
  }

  if (reset || !machine.initialized) {
    JsonObject start = doc["startPosition"].as<JsonObject>();
    if (start.isNull()) {
      Serial.println(F("[PATH] startPosition required for initialization"));
      server.send(400, "application/json", "{\"error\":\"startPosition required to initialize\"}");
      return;
    }

    const float startX = start["x"] | 0.0f;
    const float startY = start["y"] | 0.0f;
    float leftLen = start.containsKey("leftLengthMm") ? start["leftLengthMm"].as<float>() : 0.0f;
    float rightLen = start.containsKey("rightLengthMm") ? start["rightLengthMm"].as<float>() : 0.0f;

    if (!start.containsKey("leftLengthMm") || !start.containsKey("rightLengthMm")) {
      if (!computeStringLengths(startX, startY, leftLen, rightLen)) {
        Serial.printf("[PATH] Invalid startPosition: x=%.2f y=%.2f\n", startX, startY);
        server.send(422, "application/json", "{\"error\":\"Invalid startPosition coordinates\"}");
        return;
      }
    }

    machine.x_mm = startX;
    machine.y_mm = startY;
    machine.left_len_mm = leftLen;
    machine.right_len_mm = rightLen;
    if (start.containsKey("leftSteps")) {
      machine.left_steps = start["leftSteps"].as<int64_t>();
    } else {
      machine.left_steps = llround(static_cast<double>(leftLen) * static_cast<double>(STEPS_PER_MM));
    }
    if (start.containsKey("rightSteps")) {
      machine.right_steps = start["rightSteps"].as<int64_t>();
    } else {
      machine.right_steps = llround(static_cast<double>(rightLen) * static_cast<double>(STEPS_PER_MM));
    }
    machine.pen_down = start["penDown"] | false;
    machine.initialized = true;
    applyPenState(machine.pen_down);

    Serial.printf("[PATH] Initialized origin -> x=%.2f y=%.2f | leftLen=%.2f rightLen=%.2f pen=%s\n",
                  machine.x_mm,
                  machine.y_mm,
                  machine.left_len_mm,
                  machine.right_len_mm,
                  machine.pen_down ? "down" : "up");
  }

  if (!machine.initialized) {
    Serial.println(F("[PATH] Machine state unknown; refusing to execute"));
    server.send(409, "application/json", "{\"error\":\"Machine state unknown\"}");
    return;
  }

  JsonArray points = doc["points"].as<JsonArray>();
  if (points.isNull() || points.size() == 0) {
    Serial.println(F("[PATH] No points supplied"));
    server.send(400, "application/json", "{\"error\":\"points array required\"}");
    return;
  }

  Serial.printf("[PATH] Queuing %u points\n", static_cast<unsigned>(points.size()));

  // Check if adding these points would exceed queue limit
  size_t existingQueued = 0;
  lockQueue();
  existingQueued = pointQueue.size();
  unlockQueue();

  if (existingQueued + points.size() > MAX_QUEUE_SIZE) {
    Serial.printf("[PATH] Queue would exceed limit (%u + %u > %u)\n",
                  static_cast<unsigned>(existingQueued),
                  static_cast<unsigned>(points.size()),
                  static_cast<unsigned>(MAX_QUEUE_SIZE));
    server.send(429, "application/json", "{\"error\":\"Queue limit exceeded\"}");
    return;
  }

  uint32_t queued = 0;
  for (JsonVariant entryVariant : points) {
    JsonObject entry = entryVariant.as<JsonObject>();
    if (entry.isNull()) {
      continue;
    }

    const float targetX = entry["x"] | machine.x_mm;
    const float targetY = entry["y"] | machine.y_mm;
    const bool penDown = entry.containsKey("penDown") ? entry["penDown"].as<bool>() : machine.pen_down;
    const uint32_t speed = entry["speed"] | defaultSpeed;

    // Enqueue the point
    QueuedPoint point = {targetX, targetY, penDown, speed};
    lockQueue();
    pointQueue.push_back(point);
    unlockQueue();
    queued++;

    if (queued < 5 || queued % 500 == 0) {
      Serial.printf("[PATH] Queued %lu -> (%.2f, %.2f) pen=%s speed=%lu\n",
                    static_cast<unsigned long>(queued),
                    targetX,
                    targetY,
                    penDown ? "down" : "up",
                    static_cast<unsigned long>(speed));
    }
  }

  // Start execution if not already running
  bool startedExecution = false;
  size_t queueSizeSnapshot = 0;
  bool executingSnapshot = false;
  lockQueue();
  if (!isExecuting && !pointQueue.empty()) {
    isExecuting = true;
    startedExecution = true;
  }
  queueSizeSnapshot = pointQueue.size();
  executingSnapshot = isExecuting;
  unlockQueue();

  if (startedExecution) {
    Serial.println(F("[PATH] Starting asynchronous execution"));
  }

  Serial.printf("[PATH] Queued %lu points for asynchronous execution\n", static_cast<unsigned long>(queued));

  StaticJsonDocument<256> response;
  response["status"] = "queued";
  response["pointsQueued"] = queued;
  response["queueSize"] = static_cast<uint32_t>(queueSizeSnapshot);
  response["isExecuting"] = executingSnapshot;
  JsonObject state = response.createNestedObject("state");
  state["initialized"] = machine.initialized;
  state["x_mm"] = machine.x_mm;
  state["y_mm"] = machine.y_mm;
  state["penDown"] = machine.pen_down;
  JsonObject lengths = state.createNestedObject("lengths_mm");
  lengths["left"] = machine.left_len_mm;
  lengths["right"] = machine.right_len_mm;
  JsonObject steps = state.createNestedObject("steps");
  steps["left"] = machine.left_steps;
  steps["right"] = machine.right_steps;

  String payload;
  serializeJson(response, payload);
  server.send(200, "application/json", payload);
}

void setupPins() {
  for (auto& motor : motors) {
    pinMode(motor.enablePin, OUTPUT);
    pinMode(motor.dirPin, OUTPUT);
    pinMode(motor.stepPin, OUTPUT);
    enableMotor(motor, false);
  }
}

void setup() {
  Serial.begin(115200);
  driverSerial.begin(115200, SERIAL_8N1, 16, 17);

  setupPins();
  setupDriver(driverLeft);
  setupDriver(driverRight);

  queueMutex = xSemaphoreCreateMutex();
  if (queueMutex == nullptr) {
    Serial.println(F("[SETUP] Failed to create queue mutex"));
  }

  penServo.attach(PEN_SERVO_PIN, 500, 2400);
  penServo.write(PEN_UP_ANGLE);
  servoPenDown = false;
  delay(PEN_SERVO_SETTLE_MS);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected! IP: ");
  Serial.println(WiFi.localIP());

  server.on("/", handleRoot);
  server.on("/api/status", HTTP_OPTIONS, handleCorsPreflight);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/move", HTTP_OPTIONS, handleCorsPreflight);
  server.on("/api/move", HTTP_POST, handleMove);
  server.on("/api/pen", HTTP_OPTIONS, handleCorsPreflight);
  server.on("/api/pen", HTTP_POST, handlePen);
  server.on("/api/path", HTTP_OPTIONS, handleCorsPreflight);
  server.on("/api/path", HTTP_POST, handlePath);
  server.on("/api/cancel", HTTP_OPTIONS, handleCorsPreflight);
  server.on("/api/cancel", HTTP_POST, handleCancel);
  server.begin();
}

void loop() {
  server.handleClient();

  // Process queued points asynchronously
  QueuedPoint point;
  bool hasPoint = false;

  lockQueue();
  if (isExecuting && !pointQueue.empty()) {
    point = pointQueue.front();
    pointQueue.pop_front();
    hasPoint = true;
  }
  unlockQueue();

  if (!hasPoint) {
    return;
  }

    Serial.printf("[QUEUE] Executing queued point -> (%.2f, %.2f) pen=%s speed=%lu\n",
                  point.x,
                  point.y,
                  point.penDown ? "down" : "up",
                  static_cast<unsigned long>(point.speed));

    if (!moveToXY(point.x, point.y, point.penDown, point.speed)) {
      Serial.println(F("[QUEUE] moveToXY failed, stopping execution"));
      lockQueue();
      isExecuting = false;
      pointQueue.clear(); // Clear remaining points on error
      unlockQueue();
      return;
    }

    if (cancelRequested) {
      Serial.println(F("[QUEUE] Cancel detected, stopping execution"));
      cancelRequested = false;
      lockQueue();
      isExecuting = false;
      pointQueue.clear();
      unlockQueue();
      return;
    }

    // If queue is empty after processing, stop executing
    bool queueEmpty = false;
    lockQueue();
    queueEmpty = pointQueue.empty();
    if (queueEmpty) {
      isExecuting = false;
    }
    unlockQueue();

    if (queueEmpty) {
      Serial.println(F("[QUEUE] Queue empty, execution complete"));
    }
}
}
