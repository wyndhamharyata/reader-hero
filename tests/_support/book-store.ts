import { Effect, Layer, type Context } from "effect";
import { BookStore } from "@/services/book-store";

// A method the test leaves out dies when called, so each test lists only what it reads and writes.
export function bookStore(
  methods: Partial<Context.Service.Shape<typeof BookStore>>,
): Layer.Layer<BookStore> {
  return Layer.succeed(
    BookStore,
    BookStore.of(
      new Proxy(methods as Context.Service.Shape<typeof BookStore>, {
        get: (target, key: string) =>
          target[key as keyof typeof target] ?? (() => Effect.die(`${key} not used`)),
      }),
    ),
  );
}
