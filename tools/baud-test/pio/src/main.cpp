/*
 * ESP32 baudrate stress test transmitter (PlatformIO version).
 * Pairs with tools/baud-test/baud_test.py
 *
 * Usage:
 *  1. Set TEST_BAUD to the rate you want to verify.
 *  2. PlatformIO: Upload (flashes ESP32 DevKit v1 / WROOM-32 via CP2102N).
 *  3. Close PlatformIO serial monitor.
 *  4. Run baud_test.py with the same baud in a separate terminal.
 */

#include <Arduino.h>

#define TEST_BAUD 921600UL    // try 921600, 1500000, 2000000, 3000000

void setup() {
  Serial.begin(TEST_BAUD);
  delay(500);
}

void loop() {
  static uint32_t seq = 0;
  static const char payload[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";  // 108 chars
  char buf[160];
  int n = snprintf(buf, sizeof(buf), "SEQ=%08lu|%s\n", (unsigned long)seq++, payload);
  Serial.write((const uint8_t *)buf, n);
  // Tiny pacing so the TX FIFO has time to drain on slower bridges.
  delayMicroseconds(500);
}
