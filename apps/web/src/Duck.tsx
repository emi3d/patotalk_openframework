import { useEffect, useRef } from "react";

export function Duck({ level, state }: { level: () => number; state: "idle" | "talking" | "listening" | "hearing" | "thinking" }) {
  const mouth = useRef<HTMLImageElement>(null);
  useEffect(() => {
    let raf = 0;
    let openUntil = 0;
    const loop = (t: number) => {
      let l = level();
      if (!l && typeof speechSynthesis !== "undefined" && speechSynthesis.speaking) l = Math.sin(t / 55) > 0 ? 0.5 : 0;
      if (l > 0.06) openUntil = t + 70; // hold briefly so the beak doesn't flicker
      if (mouth.current) mouth.current.style.opacity = t < openUntil ? "1" : "0";
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  return (
    <div className={`duck ${state}`} aria-label="Pato">
      <img src={`${import.meta.env.BASE_URL}pato/closed.jpg`} alt="" draggable={false} />
      <img ref={mouth} className="mouth" src={`${import.meta.env.BASE_URL}pato/mouth-open.png`} alt="" draggable={false} />
    </div>
  );
}
