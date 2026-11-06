export type Sound = 'harvest' | 'chop' | 'drop' | 'serve' | 'shot' | 'machine' | 'beacon' | 'error';

/** Small original synthesis cues; no audio requests and no autoplay before a gesture. */
export class AudioFeedback {
  private context?: AudioContext;
  enabled = true;

  unlock(): void {
    if (!this.context && typeof AudioContext !== 'undefined') this.context = new AudioContext();
    if (this.context?.state === 'suspended') void this.context.resume();
  }

  play(kind: Sound): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running') return;
    const frequencies: Record<Sound, number[]> = {
      harvest: [660, 880, 1100], chop: [240], drop: [360, 480], serve: [523, 659, 784],
      shot: [125], machine: [330, 440], beacon: [523, 659, 784, 1046], error: [220, 170],
    };
    frequencies[kind].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.055;
      oscillator.type = kind === 'shot' || kind === 'chop' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === 'shot' ? 0.22 : 0.9), start + 0.09);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.035, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.15);
    });
  }

  destroy(): void { if (this.context) void this.context.close(); }
}
