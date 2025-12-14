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

// SAFETY/SMOOTHNESS TWEAKS
constexpr uint32_t DEFAULT_SPEED = 5000;     
constexpr uint32_t TRAVEL_SPEED = 12000;    // Faster speed for pen-up moves
constexpr uint16_t DEFAULT_CURRENT = 800;  
constexpr uint32_t MAX_SPEED = 30000;       // Increased max speed
constexpr uint8_t MIN_PULSE_US = 10;        // Reduced min pulse for higher speeds
constexpr uint16_t MAX_QUEUE_SIZE = 3000;   

// MACHINE GEOMETRY & RESOLUTION
constexpr float BOARD_WIDTH_MM = 1150.0f;
constexpr float BOARD_HEIGHT_MM = 730.0f;
constexpr float CONNECTION_TO_PEN_DISTANCE = 29.0f;
constexpr float DEFAULT_START_X = 575.0f;  // Physical home X
constexpr float DEFAULT_START_Y = 365.0f;  // Physical home Y
constexpr uint16_t STEPS_PER_REV = 200;
constexpr uint8_t MICROSTEPS = 32;        
constexpr float SPOOL_DIAMETER_MM = 12.0f;
constexpr float SPOOL_CIRCUMFERENCE_MM = SPOOL_DIAMETER_MM * PI;
constexpr float STEPS_PER_MM = (STEPS_PER_REV * MICROSTEPS) / SPOOL_CIRCUMFERENCE_MM;

// PEN SERVO
constexpr int PEN_SERVO_PIN = 15;
constexpr int PEN_UP_ANGLE = 45;      
constexpr int PEN_DOWN_ANGLE = 105;   
constexpr uint16_t PEN_SERVO_SETTLE_MS = 400;

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

// Hardware Serial (UART2) for TMC communication
HardwareSerial driverSerial(2);  
TMC2209Stepper driverLeft(&driverSerial, R_SENSE, DRIVER_ADDR_LEFT);
TMC2209Stepper driverRight(&driverSerial, R_SENSE, DRIVER_ADDR_RIGHT);

MotorConfig motors[] = {
  {"left", 21, 5, 4, &driverLeft, false},    // EN=21, DIR=5, STEP=4
  {"right", 19, 22, 23, &driverRight, false} // EN=19, DIR=22, STEP=23
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

// Utility to set machine state to a known absolute position (used only at cold boot default).
bool setMachineState(float x, float y, bool penDown) {
    float leftLen = 0.0f;
    float rightLen = 0.0f;
    if (!computeStringLengths(x, y, leftLen, rightLen)) {
        return false;
    }

    machine.x_mm = x;
    machine.y_mm = y;
    machine.left_len_mm = leftLen;
    machine.right_len_mm = rightLen;
    machine.left_steps = llround(static_cast<double>(leftLen) * STEPS_PER_MM);
    machine.right_steps = llround(static_cast<double>(rightLen) * STEPS_PER_MM);
    machine.pen_down = penDown;
    machine.initialized = true;
    applyPenState(penDown);
    return true;
}


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
    driver.microsteps(MICROSTEPS);
    driver.I_scale_analog(false);
}

void enableMotor(MotorConfig& motor, bool enable) {
    digitalWrite(motor.enablePin, enable ? LOW : HIGH);
}

void performSteps(MotorConfig& motor, int32_t steps, uint32_t speed) {
    motor.busy = true;

    const bool forward = steps > 0;
    const uint32_t totalSteps = static_cast<uint32_t>(abs(steps));
    const uint32_t targetSpeed = clampSpeed(speed);
    const uint32_t stepDelayUs = max(1000000UL / targetSpeed, static_cast<uint32_t>(MIN_PULSE_US * 4));

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
        
        if (i % 100 == 0) {
            yield();
            server.handleClient();
        }
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
    if (maxSteps == 0) return true;

    const uint32_t targetSpeed = clampSpeed(speed);
    const uint32_t stepDelayUs = max(1000000UL / targetSpeed, static_cast<uint32_t>(MIN_PULSE_US * 4));

    left.busy = true;
    right.busy = true;

    enableMotor(left, true);
    enableMotor(right, true);

    digitalWrite(left.dirPin, leftDelta >= 0 ? LOW : HIGH);
    digitalWrite(right.dirPin, rightDelta >= 0 ? LOW : HIGH);

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
        
        // Feed watchdog and handle network periodically to prevent timeouts and improve step timing
        if (i % 100 == 0) {
            yield();
            server.handleClient();
        }
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
    if (!penServo.attached()) return;
    if (servoPenDown == down) return;

    const int angle = down ? PEN_DOWN_ANGLE : PEN_UP_ANGLE;
    penServo.write(angle);
    delay(PEN_SERVO_SETTLE_MS);
    servoPenDown = down;
}

bool computeStringLengths(float x, float y, float& leftLen, float& rightLen) {
    if (x < 0 || y < 0) return false;

    float leftConnection_x = x - CONNECTION_TO_PEN_DISTANCE;
    float rightConnection_x = x + CONNECTION_TO_PEN_DISTANCE;

    float motor_offset_y = 60.0;

    float motor_relative_y = y + motor_offset_y;

    leftLen = sqrtf(leftConnection_x * leftConnection_x + motor_relative_y * motor_relative_y);
    float dx = BOARD_WIDTH_MM - rightConnection_x;
    rightLen = sqrtf(dx * dx + motor_relative_y * motor_relative_y);

    if (!(isfinite(leftLen) && isfinite(rightLen))) return false;
    return true;
}

bool moveToXY(float x, float y, bool penDown, uint32_t speed) {
    float targetLeftLen = 0.0f;
    float targetRightLen = 0.0f;

    if (!computeStringLengths(x, y, targetLeftLen, targetRightLen)) {
        Serial.printf("[MOVE] Invalid target (%.2f, %.2f) -> string lengths NaN\n", x, y);
        return false;
    }
    Serial.println("Left: " + String(targetLeftLen) + ", Right: " + String(targetRightLen));
    const int64_t targetLeftSteps = llround(static_cast<double>(targetLeftLen) * static_cast<double>(STEPS_PER_MM));
    const int64_t targetRightSteps = llround(static_cast<double>(targetRightLen) * static_cast<double>(STEPS_PER_MM));

    const int64_t leftDelta = targetLeftSteps - machine.left_steps;
    const int64_t rightDelta = targetRightSteps - machine.right_steps;

    if (llabs(leftDelta) > INT32_MAX || llabs(rightDelta) > INT32_MAX) {
        Serial.printf("[MOVE] Delta overflow left=%lld right=%lld\n", static_cast<long long>(leftDelta), static_cast<long long>(rightDelta));
        return false;
    }

    static uint32_t moveLogCounter = 0;
    moveLogCounter++;
    if (moveLogCounter <= 5 || moveLogCounter % 500 == 0) {
        Serial.printf("[MOVE] target=(%.2f, %.2f) pen=%s speed=%lu | leftDelta=%ld rightDelta=%ld\n",
            x, y, penDown ? "down" : "up", static_cast<unsigned long>(speed),
            static_cast<long>(leftDelta), static_cast<long>(rightDelta));
    }

    applyPenState(penDown);

    // If pen is UP, use a faster travel speed unless a specific speed was requested that is higher
    uint32_t effectiveSpeed = speed;
    if (!penDown) {
        effectiveSpeed = max(speed, TRAVEL_SPEED);
    }

    // Serial.printf("MoveToXY: (%.2f, %.2f) pen=%d speed=%u effective=%u\n", x, y, penDown, speed, effectiveSpeed);

    if (!runDualMotorSteps(static_cast<int32_t>(leftDelta), static_cast<int32_t>(rightDelta), effectiveSpeed)) {
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

// ---------- Server Handlers ----------

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

// ... (Other server handlers: handleStatus, handlePen, handleCancel, handlePath) 
// can be rewritten the same way by removing all invisible characters. 
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

    if (!server.hasArg("plain")) {
        server.send(400, "application/json", "{\"error\":\"Missing body\"}");
        return;
    }

    DynamicJsonDocument doc(16384);
    const DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (err) {
        server.send(400, "application/json", "{\"error\":\"Bad JSON\"}");
        return;
    }

    const bool reset = doc["reset"] | false;
    const uint32_t defaultSpeed = doc["speed"] | DEFAULT_SPEED;
    Serial.printf("[PATH] Received path. Reset=%s, Speed=%u\n", reset ? "yes" : "no", defaultSpeed);

    cancelRequested = false;

    if (reset) {
        lockQueue();
        pointQueue.clear();
        isExecuting = false;
        unlockQueue();
    }

    // If reset or not initialized, validate the provided startPosition and physically move there pen-up.
    // This aligns internal pose with actual gondola position before queue execution.
    if (reset || !machine.initialized) {
        JsonObject start = doc["startPosition"].as<JsonObject>();
        if (start.isNull()) {
            server.send(400, "application/json", "{\"error\":\"startPosition required to initialize\"}");
            return;
        }

        const float startX = start["x"] | machine.x_mm;
        const float startY = start["y"] | machine.y_mm;
        float leftLen = start.containsKey("leftLengthMm") ? start["leftLengthMm"].as<float>() : 0.0f;
        float rightLen = start.containsKey("rightLengthMm") ? start["rightLengthMm"].as<float>() : 0.0f;
        const bool startPenDown = start["penDown"] | false;

        if (!start.containsKey("leftLengthMm") || !start.containsKey("rightLengthMm")) {
            if (!computeStringLengths(startX, startY, leftLen, rightLen)) {
                server.send(422, "application/json", "{\"error\":\"Invalid startPosition coordinates\"}");
                return;
            }
        }

        // Synchronize lengths/steps and pen state to the declared startPosition.
        // We do NOT move to startPosition here; we assume startPosition represents the current physical state.
        // Movement to the drawing start is handled by the first point in the queue (pre-positioning).
        machine.left_len_mm = leftLen;
        machine.right_len_mm = rightLen;
        machine.left_steps = start.containsKey("leftSteps") ? start["leftSteps"].as<int64_t>() : llround(static_cast<double>(leftLen) * STEPS_PER_MM);
        machine.right_steps = start.containsKey("rightSteps") ? start["rightSteps"].as<int64_t>() : llround(static_cast<double>(rightLen) * STEPS_PER_MM);
        machine.x_mm = startX;
        machine.y_mm = startY;
        machine.initialized = true;
        applyPenState(startPenDown);
        machine.pen_down = startPenDown;
    }

    if (!machine.initialized) {
        server.send(409, "application/json", "{\"error\":\"Machine state unknown\"}");
        return;
    }

    JsonArray points = doc["points"].as<JsonArray>();
    if (points.isNull() || points.size() == 0) {
        server.send(400, "application/json", "{\"error\":\"points array required\"}");
        return;
    }

    size_t existingQueued = 0;
    lockQueue();
    existingQueued = pointQueue.size();
    unlockQueue();

    if (existingQueued + points.size() > MAX_QUEUE_SIZE) {
        server.send(429, "application/json", "{\"error\":\"Queue limit exceeded\"}");
        return;
    }

    uint32_t queued = 0;
    for (JsonVariant entryVariant : points) {
        JsonObject entry = entryVariant.as<JsonObject>();
        if (entry.isNull()) continue;

        const float targetX = entry["x"] | machine.x_mm;
        const float targetY = entry["y"] | machine.y_mm;
        const bool penDown = entry.containsKey("penDown") ? entry["penDown"].as<bool>() : machine.pen_down;
        const uint32_t speed = entry["speed"] | defaultSpeed;

        QueuedPoint point = {targetX, targetY, penDown, speed};
        lockQueue();
        pointQueue.push_back(point);
        unlockQueue();
        queued++;
    }

    // Pre-positioning block removed to prevent blocking HTTP response.
    // The first point (travel to start) will be handled by the main loop() like any other point.
    /*
    QueuedPoint firstSnapshot;
    bool shouldPreposition = false;
    lockQueue();
    if (!isExecuting && !pointQueue.empty()) {
        firstSnapshot = pointQueue.front();
        shouldPreposition = true;
    }
    unlockQueue();

    if (shouldPreposition) {
        Serial.println(F("[PATH] Pre-positioning to first point with pen UP"));
        applyPenState(false);
        machine.pen_down = false;
        if (!moveToXY(firstSnapshot.x, firstSnapshot.y, false, defaultSpeed)) {
            lockQueue();
            pointQueue.clear();
            isExecuting = false;
            unlockQueue();
            server.send(422, "application/json", "{\"error\":\"Failed to move to first point\"}");
            return;
        }
        // moveToXY updated machine.* to the real pose after travel
        machine.initialized = true;
    }
    */

    bool startedExecution = false;
    lockQueue();
    if (!isExecuting && !pointQueue.empty()) {
        isExecuting = true;
        startedExecution = true;
    }
    unlockQueue();

    StaticJsonDocument<256> response;
    response["status"] = "queued";
    response["pointsQueued"] = queued;
    response["queueSize"] = pointQueue.size();
    response["isExecuting"] = isExecuting;

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
    if (!queueMutex) {
        Serial.println(F("[SETUP] Failed to create queue mutex"));
    }

    penServo.attach(PEN_SERVO_PIN, 500, 2400);
    penServo.write(PEN_UP_ANGLE);
    servoPenDown = false;
    delay(PEN_SERVO_SETTLE_MS);

    // Initialize machine pose to known physical start.
    if (!setMachineState(DEFAULT_START_X, DEFAULT_START_Y, false)) {
        Serial.println(F("[SETUP] Failed to set default start pose; machine remains uninitialized"));
        machine.initialized = false;
    }

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

    QueuedPoint point;
    bool hasPoint = false;

    lockQueue();
    if (isExecuting && !pointQueue.empty()) {
        point = pointQueue.front();
        pointQueue.pop_front();
        hasPoint = true;
    }
    unlockQueue();

    if (!hasPoint) return;

    Serial.printf("[QUEUE] Executing queued point -> (%.2f, %.2f) pen=%s speed=%lu\n",
        point.x, point.y, point.penDown ? "down" : "up", static_cast<unsigned long>(point.speed));

    if (!moveToXY(point.x, point.y, point.penDown, point.speed)) {
        Serial.println(F("[QUEUE] moveToXY failed, stopping execution"));
        lockQueue();
        isExecuting = false;
        pointQueue.clear();
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

    bool queueEmpty = false;
    lockQueue();
    queueEmpty = pointQueue.empty();
    if (queueEmpty) isExecuting = false;
    unlockQueue();

    if (queueEmpty) {
        Serial.println(F("[QUEUE] Queue empty, execution complete"));
    }
}
