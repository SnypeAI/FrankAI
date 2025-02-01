class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRecording = false;
    this.audioBuffer = [];
    this.targetSampleRate = 16000;  // Target sample rate for Whisper
    this.inputSampleRate = 44100;   // Default input sample rate
    this.port.onmessage = this.handleMessage.bind(this);
  }

  handleMessage(event) {
    if (event.data.command === 'start') {
      console.log('Starting recording');
      this.isRecording = true;
      this.audioBuffer = [];
    } else if (event.data.command === 'stop') {
      console.log('Stopping recording');
      this.isRecording = false;
      // Send all accumulated audio data
      if (this.audioBuffer.length > 0) {
        const completeBuffer = new Float32Array(this.audioBuffer);
        if (completeBuffer.some(sample => sample !== 0)) {
          this.port.postMessage({
            type: 'audioData',
            buffer: completeBuffer.buffer
          }, [completeBuffer.buffer]);
        }
      }
      this.audioBuffer = [];
    } else if (event.data.command === 'setSampleRate') {
      this.inputSampleRate = event.data.sampleRate;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (input && input.length > 0 && this.isRecording) {
      // Get the first channel of audio
      const audioData = input[0];
      
      // Check if we're getting audio data
      if (audioData.some(sample => sample !== 0)) {
        // Downsample the audio data
        const downsampledData = this.downsample(audioData);
        
        // Add the downsampled data to our buffer
        this.audioBuffer.push(...downsampledData);
      }
    }
    return true;
  }

  downsample(audioData) {
    const ratio = this.inputSampleRate / this.targetSampleRate;
    const downsampledLength = Math.floor(audioData.length / ratio);
    const downsampledData = new Float32Array(downsampledLength);
    
    for (let i = 0; i < downsampledLength; i++) {
      const index = Math.floor(i * ratio);
      downsampledData[i] = audioData[index];
    }
    
    return downsampledData;
  }
}

registerProcessor('audio-processor', AudioProcessor);