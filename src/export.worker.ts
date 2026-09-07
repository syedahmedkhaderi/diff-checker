import { patch, report, type Options } from "./diff";
self.onmessage = (
  event: MessageEvent<{
    kind: "patch" | "report";
    a: string;
    b: string;
    nameA: string;
    nameB: string;
    options: Options;
  }>,
) => {
  try {
    const { kind, a, b, nameA, nameB, options } = event.data;
    const data =
      kind === "patch"
        ? patch(a, b, nameA, nameB)
        : report(a, b, nameA, nameB, options);
    self.postMessage({ data });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
