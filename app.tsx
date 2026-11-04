import { useEffect, useMemo, useRef, useState } from "react";
import htmlSrc from "../vanilla/index.html?raw";
import cssSrc from "../vanilla/style.css?raw";
import jsSrc from "../vanilla/script.js?raw";
import { cn } from "./utils/cn";
type FileKey = "index.html" | "style.css" | "script.js";
const FILES: { key: FileKey; content: string; color: string; desc: string }[] = [
  { key: "index.html", content: htmlSrc, color: "text-orange-300", desc: "Estrutura da página: canvas, placar, botões e legendas." },
  { key: "style.css", content: cssSrc, color: "text-sky-300", desc: "Visual: layout responsivo, cards, botões e cores." },
  { key: "script.js", content: jsSrc, color: "text-yellow-200", desc: "Toda a lógica do jogo: física, ondas, inimigos, chefes, som e HUD." },
];
/** Monta um documento HTML único com CSS e JS embutidos (equivale a abrir index.html na pasta). */
function buildSrcDoc() {
  return htmlSrc
    .replace('<link rel="stylesheet" href="style.css" />', `<style>\n${cssSrc}\n</style>`)
    .replace('<script src="script.js"></script>', `<script>\n${jsSrc}\n</script>`);
}
function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const MIME: Record<FileKey, string> = {
  "index.html": "text/html",
  "style.css": "text/css",
  "script.js": "text/javascript",
};
export default function App() {
  const [view, setView] = useState<"play" | "code">("play");
  const [active, setActive] = useState<FileKey>("script.js");
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(buildSrcDoc, []);
  const file = FILES.find((f) => f.key === active)!;
  useEffect(() => {
    if (view === "play") {
      const t = setTimeout(() => iframeRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [view]);
  const copy = async () => {
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const downloadAll = () => {
    FILES.forEach((f, i) => setTimeout(() => download(f.key, f.content, MIME[f.key]), i * 300));
  };
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/80">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-violet-600">
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l5 14-5-3-5 3z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight">Nebula Defender</h1>
              <p className="text-xs text-slate-400">
                Versão vanilla: <code className="text-orange-300">index.html</code> +{" "}
                <code className="text-sky-300">style.css</code> + <code className="text-yellow-200">script.js</code>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1">
              {(
                [
                  ["play", "▶ Jogar"],
                  ["code", "</> Código"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                    view === id ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={downloadAll}
              className="rounded-md bg-gradient-to-r from-sky-500 to-violet-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-violet-600/30 hover:brightness-110"
            >
              ⬇ Baixar os 3 arquivos
            </button>
          </div>
        </div>
      </header>
      {view === "play" ? (
        <main className="flex flex-1 flex-col">
          <iframe
            ref={iframeRef}
            title="Nebula Defender"
            srcDoc={srcDoc}
            className="w-full flex-1 border-0"
            style={{ minHeight: "calc(100vh - 61px)" }}
            allow="autoplay"
          />
        </main>
      ) : (
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
            <p className="font-semibold text-white">Como usar fora do React</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
              <li>Clique em <b className="text-slate-200">Baixar os 3 arquivos</b> e coloque-os na mesma pasta.</li>
              <li>
                Abra <code className="text-orange-300">index.html</code> no navegador (duplo clique) — ou rode{" "}
                <code className="text-emerald-300">npx serve .</code> na pasta.
              </li>
              <li>
                Pronto. Nenhuma dependência, nenhum build. O <code className="text-yellow-200">script.js</code> é a única
                parte com lógica.
              </li>
            </ol>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
              <div className="flex gap-1">
                {FILES.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setActive(f.key)}
                    className={cn(
                      "rounded-md px-3 py-1.5 font-mono text-xs transition",
                      active === f.key ? cn("bg-slate-800", f.color) : "text-slate-400 hover:text-slate-200",
                    )}
                  >
                    {f.key}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-slate-500 sm:inline">
                  {file.content.split("\n").length} linhas
                </span>
                <button
                  onClick={copy}
                  className={cn(
                    "rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white",
                    copied && "border-emerald-500 text-emerald-400",
                  )}
                >
                  {copied ? "✓ Copiado" : "Copiar"}
                </button>
                <button
                  onClick={() => download(file.key, file.content, MIME[file.key])}
                  className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                >
                  ⬇ Baixar
                </button>
              </div>
            </div>
            <p className="border-b border-slate-800 px-4 py-2 text-xs text-slate-400">{file.desc}</p>
            <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200">
              <code>{file.content}</code>
            </pre>
          </div>
        </main>
      )}
    </div>
  );
}
