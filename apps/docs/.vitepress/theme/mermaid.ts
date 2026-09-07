let mermaidPromise: Promise<typeof import("mermaid").default> | undefined;
let renderQueue: Promise<void> = Promise.resolve();
let renderNumber = 0;

function loadMermaid() {
  mermaidPromise ??= import("mermaid").then(({ default: mermaid }) => mermaid);
  return mermaidPromise;
}

export function renderMermaid(source: string, darkMode: boolean) {
  const render = async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: darkMode ? "dark" : "neutral"
    });

    renderNumber += 1;
    return mermaid.render(`cgn-mermaid-${renderNumber}`, source);
  };

  const result = renderQueue.then(render, render);
  renderQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
