class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 4096;
    this._buffer = new Float32Array(this._bufferSize);
    this._bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const channel = input[0];

    if (!channel) return true;

    // Fill the buffer
    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._bufferIndex] = channel[i];
      this._bufferIndex++;

      // When buffer is full, send it for processing
      if (this._bufferIndex === this._bufferSize) {
        this.port.postMessage({
          type: "audio-data",
          audioData: Array.from(this._buffer),
        });
        this._bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
