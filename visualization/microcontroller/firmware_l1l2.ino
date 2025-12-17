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
constexpr uint32_t TRAVEL_SPEED = 6000;    // Faster speed for pen-up moves
constexpr uint16_t DEFAULT_CURRENT = 800;  
constexpr uint32_t MAX_SPEED = 6000;       // Increased max speed
constexpr uint8_t MIN_PULSE_US = 10;        // Reduced min pulse for higher speeds
constexpr uint16_t MAX_QUEUE_SIZE = 3000;   

// MACHINE GEOMETRY & RESOLUTION
constexpr float BOARD_WIDTH_MM = 1150.0f;
constexpr float BOARD_HEIGHT_MM = 730.0f;
constexpr float CONNECTION_TO_PEN_DISTANCE = 29.0f;
constexpr float MOTOR_OFFSET_Y = 60.0f;
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
    float l1;
    float l2;
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
bool endOfJobReceived = false;
SemaphoreHandle_t queueMutex = nullptr;
SemaphoreHandle_t stateMutex = nullptr;

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

static inline void lockState() {
    if (stateMutex) {
        xSemaphoreTake(stateMutex, portMAX_DELAY);
    }
}

static inline void unlockState() {
    if (stateMutex) {
        xSemaphoreGive(stateMutex);
    }
}

Servo penServo;
bool servoPenDown = false;
volatile bool cancelRequested = false;

void applyPenState(bool down);

// Forward declaration
bool computeStringLengths(float x, float y, float& leftLen, float& rightLen);

// Forward Kinematics: Calculate X/Y from string lengths
bool computeXYFromLengths(float l1, float l2, float &x, float &y) {
    float d = CONNECTION_TO_PEN_DISTANCE;
    float h = MOTOR_OFFSET_Y;
    float W = BOARD_WIDTH_MM;
    float W_prime = W - d;
    
    // Derived from:
    // L1^2 = (x-d)^2 + (y+h)^2
    // L2^2 = (W-(x+d))^2 + (y+h)^2
    // Solving for x:
    float denominator = 2.0f * (d - W_prime);
    if (abs(denominator) < 0.001f) return false;

    float numerator = (l2 * l2) - (l1 * l1) + (d * d) - (W_prime * W_prime);
    x = numerator / denominator;

    // Solving for y:
    float term = (l1 * l1) - ((x - d) * (x - d));
    if (term < 0) return false;
    
    y = sqrt(term) - h;
    return true;
}

// Utility to set machine state to a known absolute position (used only at cold boot default).
bool setMachineState(float x, float y, bool penDown) {
    float leftLen = 0.0f;
    float rightLen = 0.0f;
    if (!computeStringLengths(x, y, leftLen, rightLen)) {
        return false;
    }

    lockState();
    machine.x_mm = x;
    machine.y_mm = y;
    machine.left_len_mm = leftLen;
    machine.right_len_mm = rightLen;
    machine.left_steps = llround(static_cast<double>(leftLen) * STEPS_PER_MM);
    machine.right_steps = llround(static_cast<double>(rightLen) * STEPS_PER_MM);
    machine.pen_down = penDown;
    machine.initialized = true;
    unlockState();
    
    applyPenState(penDown);
    return true;
}

// Overload for setting state directly from lengths
bool setMachineStateLengths(float l1, float l2, bool penDown) {
    float x = 0.0f;
    float y = 0.0f;
    computeXYFromLengths(l1, l2, x, y); // Best effort to update X/Y for status

    lockState();
    machine.x_mm = x;
    machine.y_mm = y;
    machine.left_len_mm = l1;
    machine.right_len_mm = l2;
    machine.left_steps = llround(static_cast<double>(l1) * STEPS_PER_MM);
    machine.right_steps = llround(static_cast<double>(l2) * STEPS_PER_MM);
    machine.pen_down = penDown;
    machine.initialized = true;
    unlockState();

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

    float motor_relative_y = y + MOTOR_OFFSET_Y;

    leftLen = sqrtf(leftConnection_x * leftConnection_x + motor_relative_y * motor_relative_y);
    float dx = BOARD_WIDTH_MM - rightConnection_x;
    rightLen = sqrtf(dx * dx + motor_relative_y * motor_relative_y);

    if (!(isfinite(leftLen) && isfinite(rightLen))) return false;
    return true;
}

bool moveToLengths(float l1, float l2, bool penDown, uint32_t speed) {
    if (!isfinite(l1) || !isfinite(l2)) {
        Serial.println("[MOVE] Invalid target lengths");
        return false;
    }

    const int64_t targetLeftSteps = llround(static_cast<double>(l1) * static_cast<double>(STEPS_PER_MM));
    const int64_t targetRightSteps = llround(static_cast<double>(l2) * static_cast<double>(STEPS_PER_MM));

    const int64_t leftDelta = targetLeftSteps - machine.left_steps;
    const int64_t rightDelta = targetRightSteps - machine.right_steps;

    if (llabs(leftDelta) > INT32_MAX || llabs(rightDelta) > INT32_MAX) {
        Serial.printf("[MOVE] Delta overflow left=%lld right=%lld\n", static_cast<long long>(leftDelta), static_cast<long long>(rightDelta));
        return false;
    }

    static uint32_t moveLogCounter = 0;
    moveLogCounter++;
    if (moveLogCounter <= 5 || moveLogCounter % 500 == 0) {
        Serial.printf("[MOVE] target=(L1:%.2f, L2:%.2f) pen=%s speed=%lu | leftDelta=%ld rightDelta=%ld\n",
            l1, l2, penDown ? "down" : "up", static_cast<unsigned long>(speed),
            static_cast<long>(leftDelta), static_cast<long>(rightDelta));
    }

    applyPenState(penDown);

    // If pen is UP, use a faster travel speed unless a specific speed was requested that is higher
    uint32_t effectiveSpeed = speed;
    if (!penDown) {
        effectiveSpeed = max(speed, TRAVEL_SPEED);
    }

    if (!runDualMotorSteps(static_cast<int32_t>(leftDelta), static_cast<int32_t>(rightDelta), effectiveSpeed)) {
        return false;
    }

    lockState();
    machine.left_steps = targetLeftSteps;
    machine.right_steps = targetRightSteps;
    machine.left_len_mm = l1;
    machine.right_len_mm = l2;
    
    // Update X/Y for status reporting
    computeXYFromLengths(l1, l2, machine.x_mm, machine.y_mm);
    
    machine.pen_down = penDown;
    unlockState();

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

    lockState();
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
    unlockState();

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
    server.send(200, "text/plain", "ESP32 motion controller online (Length-based).");
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
    endOfJobReceived = false;
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
    const bool endOfJob = doc["endOfJob"] | false;
    const uint32_t defaultSpeed = doc["speed"] | DEFAULT_SPEED;
    Serial.printf("[PATH] Received path. Reset=%s, EndOfJob=%s, Speed=%u\n", reset ? "yes" : "no", endOfJob ? "yes" : "no", defaultSpeed);

    cancelRequested = false;

    if (reset) {
        lockQueue();
        pointQueue.clear();
        isExecuting = false;
        endOfJobReceived = false;
        unlockQueue();
    }

    // If reset or not initialized, validate the provided startPosition
    if (reset || !machine.initialized) {
        JsonObject start = doc["startPosition"].as<JsonObject>();
        if (start.isNull()) {
            server.send(400, "application/json", "{\"error\":\"startPosition required to initialize\"}");
            return;
        }

        // Expect l1/l2 in startPosition
        float l1 = 0.0f;
        float l2 = 0.0f;
        bool hasLengths = false;

        if (start.containsKey("l1") && start.containsKey("l2")) {
            l1 = start["l1"];
            l2 = start["l2"];
            hasLengths = true;
        } else if (start.containsKey("leftLengthMm") && start.containsKey("rightLengthMm")) {
            l1 = start["leftLengthMm"];
            l2 = start["rightLengthMm"];
            hasLengths = true;
        } else if (start.containsKey("x") && start.containsKey("y")) {
            // Fallback to computing from X/Y if lengths not provided
            float startX = start["x"];
            float startY = start["y"];
            if (computeStringLengths(startX, startY, l1, l2)) {
                hasLengths = true;
            }
        }

        if (!hasLengths) {
            server.send(422, "application/json", "{\"error\":\"Invalid startPosition (need l1/l2 or valid x/y)\"}");
            return;
        }

        const bool startPenDown = start["penDown"] | false;

        // Synchronize lengths/steps and pen state to the declared startPosition.
        setMachineStateLengths(l1, l2, startPenDown);
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

        float l1 = 0.0f;
        float l2 = 0.0f;
        
        if (entry.containsKey("l1") && entry.containsKey("l2")) {
            l1 = entry["l1"];
            l2 = entry["l2"];
        } else if (entry.containsKey("x") && entry.containsKey("y")) {
            // Fallback for mixed payloads
            float x = entry["x"];
            float y = entry["y"];
            if (!computeStringLengths(x, y, l1, l2)) {
                continue; // Skip invalid points
            }
        } else {
            continue;
        }

        const bool penDown = entry.containsKey("penDown") ? entry["penDown"].as<bool>() : machine.pen_down;
        const uint32_t speed = entry["speed"] | defaultSpeed;

        QueuedPoint point = {l1, l2, penDown, speed};
        lockQueue();
        pointQueue.push_back(point);
        unlockQueue();
        queued++;
    }

    if (endOfJob) {
        lockQueue();
        endOfJobReceived = true;
        unlockQueue();
    }

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

    String payload;
    serializeJson(response, payload);
    server.send(200, "application/json", payload);
}

void handlePark() {
    addCorsHeaders();
    if (server.method() != HTTP_POST) {
        server.send(405, "application/json", "{\"error\":\"Use POST\"}");
        return;
    }

    // Park position: (900, 100)
    float targetX = 900.0f;
    float targetY = 100.0f;
    float l1 = 0.0f;
    float l2 = 0.0f;

    if (!computeStringLengths(targetX, targetY, l1, l2)) {
        server.send(422, "application/json", "{\"error\":\"Park position unreachable\"}");
        return;
    }

    QueuedPoint point = {l1, l2, false, TRAVEL_SPEED};

    lockQueue();
    pointQueue.push_back(point);
    endOfJobReceived = true;
    // Ensure execution starts if it was idle
    if (!isExecuting && !pointQueue.empty()) {
        isExecuting = true;
    }
    unlockQueue();

    StaticJsonDocument<128> response;
    response["status"] = "queued";
    response["action"] = "park";
    response["target_x"] = targetX;
    response["target_y"] = targetY;

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

    stateMutex = xSemaphoreCreateMutex();
    if (!stateMutex) {
        Serial.println(F("[SETUP] Failed to create state mutex"));
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
    server.on("/api/park", HTTP_OPTIONS, handleCorsPreflight);
    server.on("/api/park", HTTP_POST, handlePark);
    server.begin();

    xTaskCreatePinnedToCore(
        serverTask,   // Function to implement the task
        "ServerTask", // Name of the task
        8192,         // Stack size in words
        NULL,         // Task input parameter
        1,            // Priority of the task
        NULL,         // Task handle
        0             // Core where the task should run (0 = Protocol Core)
    );
}

void serverTask(void *pvParameters) {
    while (true) {
        server.handleClient();
        vTaskDelay(pdMS_TO_TICKS(5)); // Small delay to yield to WiFi stack
    }
}

void loop() {
    // server.handleClient(); // Moved to serverTask

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

    // Throttle logging to avoid slowing down high-resolution paths
    static uint32_t loopLogCounter = 0;
    loopLogCounter++;
    if (loopLogCounter % 100 == 0) {
        Serial.printf("[QUEUE] Executing queued point -> (L1:%.2f, L2:%.2f) pen=%s speed=%lu\n",
            point.l1, point.l2, point.penDown ? "down" : "up", static_cast<unsigned long>(point.speed));
    }

    if (!moveToLengths(point.l1, point.l2, point.penDown, point.speed)) {
        Serial.println(F("[QUEUE] moveToLengths failed, stopping execution"));
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
    if (queueEmpty) {
        if (endOfJobReceived) {
            isExecuting = false;
            endOfJobReceived = false;
            Serial.println(F("[QUEUE] Queue empty and endOfJob received, execution complete"));
        }
    }
    unlockQueue();
}
