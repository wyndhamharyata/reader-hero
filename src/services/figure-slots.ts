import { Context, Layer, Semaphore } from "effect";

// At most 3 figure jobs at once: each holds a whole PDF and its decoded images, and iOS kills the page when many run.
export class FigureSlots extends Context.Service<FigureSlots, Semaphore.Semaphore>()(
  "reader-hero/FigureSlots",
) {
  static readonly layer = Layer.effect(FigureSlots, Semaphore.make(3));
}
