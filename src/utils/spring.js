export class Spring {
  constructor(value = 0, { stiffness = 220, damping = 24, mass = 1, precision = 0.0005 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
    this.mass = mass;
    this.precision = precision;
  }

  set(target) {
    this.target = target;
  }

  snap(value) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  get settled() {
    return this.velocity === 0 && this.value === this.target;
  }

  /** Advances the simulation; returns true once at rest. */
  step(dt) {
    if (this.settled) return true;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += (force / this.mass) * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.velocity) < this.precision && Math.abs(this.value - this.target) < this.precision) {
      this.value = this.target;
      this.velocity = 0;
      return true;
    }
    return false;
  }
}

/** Samples a damped spring into a CSS linear() easing so CSS transitions get real spring physics. */
export function springEasing({ stiffness = 200, damping = 18, mass = 1 } = {}, points = 56) {
  const spring = new Spring(0, { stiffness, damping, mass, precision: 0.0008 });
  spring.set(1);
  const dt = 1 / 600;
  const samples = [0];
  let time = 0;
  while (!spring.step(dt) && time < 4) {
    time += dt;
    samples.push(spring.value);
  }
  samples.push(1);
  time += dt;
  const values = [];
  for (let i = 0; i <= points; i++) {
    const index = Math.round((i / points) * (samples.length - 1));
    values.push(Number(samples[index].toFixed(4)));
  }
  values[0] = 0;
  values[values.length - 1] = 1;
  return { easing: `linear(${values.join(', ')})`, duration: Math.round(time * 1000) };
}
