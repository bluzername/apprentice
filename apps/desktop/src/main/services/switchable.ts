/** Holder that lets demo mode swap an implementation (screen source, actuator) without rewiring consumers. */
export class Switchable<T> {
  constructor(private value: T) {}

  get current(): T {
    return this.value;
  }

  use(value: T): void {
    this.value = value;
  }
}
