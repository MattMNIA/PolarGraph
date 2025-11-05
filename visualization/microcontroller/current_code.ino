#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <TMCStepper.h>

constexpr char WIFI_SSID[] = "Pataflafla";
constexpr char WIFI_PASS[] = "(l)Rlr(r)L(l)R";

constexpr float R_SENSE = 0.11f;

constexpr uint8_t DRIVER_ADDR_LEFT = 0b00;
constexpr uint8_t DRIVER_ADDR_RIGHT = 0b01;

constexpr uint32_t DEFAULT_SPEED = 1200;   // steps per second
constexpr uint16_t DEFAULT_CURRENT = 800;  // milliamps
constexpr uint32_t MAX_SPEED = 5000;       // guard rail for mechanics
constexpr uint8_t MIN_PULSE_US = 2;        // high/low pulse width

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
  {"left",  14, 13, 12, &driverLeft,  false},
  {"right", 27, 26, 25, &driverRight, false}
};

WebServer server(80);

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
    digitalWrite(motor.stepPin, HIGH);
    delayMicroseconds(MIN_PULSE_US);
    digitalWrite(motor.stepPin, LOW);
    delayMicroseconds(stepDelayUs - MIN_PULSE_US);
  }

  motor.busy = false;
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
  StaticJsonDocument<192> doc;
  doc["wifi"]["ip"] = WiFi.localIP().toString();

  JsonArray motorsArray = doc.createNestedArray("motors");
  for (auto& motor : motors) {
    JsonObject entry = motorsArray.createNestedObject();
    entry["id"] = motor.id;
    entry["busy"] = motor.busy;
  }

  String payload;
  serializeJson(doc, payload);
  server.send(200, "application/json", payload);
}

void handleRoot() {
  addCorsHeaders();
  server.send(200, "text/plain", "ESP32 motion controller online.");
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
  server.begin();
}

void loop() {
  server.handleClient();
}