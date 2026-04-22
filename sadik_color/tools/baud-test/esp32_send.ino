/*
 * ESP32 baudrate stress test transmitter.
 * Pairs with tools/baud-test/baud_test.py
 *
 * Usage:
 *  1. Set TEST_BAUD to the rate you want to verify.
 *  2. Flash this sketch to the ESP32 (DevKit v1, WROOM-32, CP2102N).
 *  3. Close Arduino serial monitor.
 *  4. Run baud_test.py with the same baud.
 *
 * Sends continuous sequenced lines; each line is ~136 bytes. At 2 Mbps
 * this produces roughly 1.7 MBit/s of payload — enough to saturate the
 * UART and expose any dropped bytes.
 */

#define TEST_BAUD 2000000UL   // try 921600, 1500000, 2000000, 3000000

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
  int n = snprintf(buf, sizeof(buf), "SEQ=%08lu|%s\n", seq++, payload);
  Serial.write((const uint8_t *)buf, n);
  // Tiny pacing so the TX FIFO has time to drain on slower bridges.
  // At 2 Mbps this still pushes > 150 KB/s on the wire.
  delayMicroseconds(500);
}
