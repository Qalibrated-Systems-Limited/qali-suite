"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { redeemRemoteToken } from "@/app/db/actions/remote-access-actions";

const LINES = [
  "The office Wi-Fi is waving at you from afar.",
  "Our servers miss you. They told us.",
  "Even the coffee machine is wondering where you went.",
  "Spreadsheets are safest at the office. Mostly.",
  "Your desk plant is fine. Probably.",
  "Somewhere, a stapler is waiting patiently.",
];

/** QSR-XXXX-XXXX-XXXX-XXXX as you type. */
function shape(v) {
  const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^QSR/, "").slice(0, 16);
  const groups = raw.match(/.{1,4}/g) || [];
  return raw ? `QSR-${groups.join("-")}` : "";
}

export default function AwayScene({ firstName }) {
  const router = useRouter();
  const [line, setLine] = useState(0);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState(null);
  const [pending, start] = useTransition();
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), 4200);
    return () => clearInterval(t);
  }, []);

  function submit(e) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      try {
        const r = await redeemRemoteToken(token);
        if (r?.success) {
          setCelebrate(true);
          setMsg({ ok: true, text: r.message });
          setTimeout(() => router.replace("/dashboard"), 1400);
        } else setMsg({ ok: false, text: r?.error || "That did not work." });
      } catch {
        setMsg({ ok: false, text: "Could not reach QaliSuite. Check your connection and try again." });
      }
    });
  }

  return (
    <main className="away">
      <style>{CSS}</style>
      <div className="sky" aria-hidden="true">
        <div className="stars" />
        <div className="sun" />
        <div className="cloud c1" /><div className="cloud c2" /><div className="cloud c3" />
        <div className="bird b1"><span /><span /></div>
        <div className="bird b2"><span /><span /></div>
        <div className="balloon">
          <div className="envelope"><span className="q">Q</span></div>
          <div className="ropes" />
          <div className="basket"><span className="person" /></div>
        </div>
        <div className="city">
          <div className="tower t1" /><div className="tower t2" />
          <div className="office">
            <div className="wifi"><i /><i /><i /></div>
            <div className="windows">{Array.from({ length: 12 }).map((_, i) => <b key={i} style={{ animationDelay: `${(i * 0.37) % 3}s` }} />)}</div>
            <div className="sign">OFFICE</div>
          </div>
          <div className="tower t3" />
        </div>
        <div className="ground" />
        {celebrate && <div className="confetti">{Array.from({ length: 28 }).map((_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.08}s` }} />)}</div>}
      </div>

      <section className="card" aria-live="polite">
        <p className="eyebrow">QaliSuite · remote access</p>
        <h1>Hello {firstName}, you're out of office range</h1>
        <p className="lead">
          Your company keeps QaliSuite to the office network. Hop back on the office Wi-Fi, or enter the
          remote-access token your system administrator gave you.
        </p>
        <p className="quip" key={line}>{LINES[line]}</p>

        <form onSubmit={submit}>
          <label htmlFor="token">Remote-access token</label>
          <input
            id="token"
            value={token}
            onChange={(e) => setToken(shape(e.target.value))}
            placeholder="QSR-XXXX-XXXX-XXXX-XXXX"
            autoComplete="one-time-code"
            spellCheck={false}
            inputMode="text"
          />
          <button type="submit" disabled={pending || token.length < 23}>
            {pending ? <span className="dots"><i /><i /><i /></span> : "Let me in"}
          </button>
        </form>
        {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}

        <div className="links">
          <button type="button" onClick={() => router.refresh()}>I'm back at the office — check again</button>
          <button type="button" onClick={() => signOut({ callbackUrl: "/login" })}>Sign out</button>
        </div>
        <p className="small">No token? Ask your system administrator: it is issued per person and expires.</p>
      </section>
    </main>
  );
}

const CSS = `
.away { min-height: 100dvh; position: relative; overflow: hidden; display: grid; place-items: center;
  padding: 24px 16px; font-family: inherit; color: #0d2238;
  --sky1: #9bd3ff; --sky2: #e8f5ff; --cloud: #ffffff; --ground: #c9e7b1; --tower: #b8c7d9; --card: rgba(255,255,255,.86); }
@media (prefers-color-scheme: dark) { :root:not(.light) .away { --sky1:#06142a; --sky2:#183a63; --cloud:#c7d6e8; --ground:#123524; --tower:#2b4566; --card: rgba(13,34,56,.86); color:#e7edf3; } }
.dark .away { --sky1:#06142a; --sky2:#183a63; --cloud:#c7d6e8; --ground:#123524; --tower:#2b4566; --card: rgba(13,34,56,.86); color:#e7edf3; }
.light .away { --sky1: #9bd3ff; --sky2: #e8f5ff; --cloud: #ffffff; --ground: #c9e7b1; --tower: #b8c7d9; --card: rgba(255,255,255,.86); color:#0d2238; }
.sky { position: absolute; inset: 0; background: linear-gradient(180deg, var(--sky1), var(--sky2)); }
.stars { position: absolute; inset: 0; opacity: 0; background-image: radial-gradient(1.5px 1.5px at 10% 20%, #fff, transparent), radial-gradient(1px 1px at 30% 10%, #fff, transparent), radial-gradient(1.5px 1.5px at 55% 25%, #fff, transparent), radial-gradient(1px 1px at 75% 12%, #fff, transparent), radial-gradient(1.5px 1.5px at 90% 30%, #fff, transparent), radial-gradient(1px 1px at 45% 40%, #fff, transparent); animation: twinkle 3s ease-in-out infinite alternate; }
.dark .stars { opacity: .9 } @media (prefers-color-scheme: dark) { :root:not(.light) .stars { opacity:.9 } }
.sun { position: absolute; top: 8%; right: 10%; width: 90px; height: 90px; border-radius: 50%; background: radial-gradient(circle, #ffe680, #f5a800); box-shadow: 0 0 60px #ffd54a; animation: pulse 5s ease-in-out infinite; }
.dark .sun { background: radial-gradient(circle, #fffbe6, #d9dfe8); box-shadow: 0 0 40px #b8c7d9; }
.cloud { position: absolute; background: var(--cloud); border-radius: 60px; opacity: .9; animation: drift linear infinite; }
.cloud::before, .cloud::after { content: ""; position: absolute; background: var(--cloud); border-radius: 50%; }
.c1 { top: 14%; width: 150px; height: 44px; animation-duration: 48s; }
.c1::before { width: 70px; height: 70px; top: -34px; left: 24px; } .c1::after { width: 50px; height: 50px; top: -22px; left: 78px; }
.c2 { top: 32%; width: 110px; height: 34px; animation-duration: 64s; animation-delay: -20s; opacity: .7; }
.c2::before { width: 50px; height: 50px; top: -24px; left: 18px; } .c2::after { width: 40px; height: 40px; top: -16px; left: 56px; }
.c3 { top: 6%; width: 90px; height: 28px; animation-duration: 80s; animation-delay: -45s; opacity: .6; }
.c3::before { width: 40px; height: 40px; top: -20px; left: 14px; } .c3::after { width: 30px; height: 30px; top: -12px; left: 46px; }
.bird { position: absolute; top: 22%; left: -40px; animation: fly 22s linear infinite; }
.b2 { top: 27%; animation-duration: 26s; animation-delay: -9s; transform: scale(.8); }
.bird span { display: inline-block; width: 12px; height: 2px; background: #2b3a4a; border-radius: 2px; transform-origin: right center; animation: flap .5s ease-in-out infinite alternate; }
.bird span + span { transform-origin: left center; animation-name: flap2; }
.dark .bird span { background: #c7d6e8; }
.balloon { position: absolute; left: 12%; top: 18%; animation: float 7s ease-in-out infinite, wander 30s ease-in-out infinite alternate; }
.envelope { width: 96px; height: 116px; border-radius: 50% 50% 46% 46% / 58% 58% 42% 42%; background: repeating-linear-gradient(90deg, #f5a800 0 16px, #1b3a5c 16px 32px); display: grid; place-items: center; box-shadow: inset -10px -8px 0 rgba(0,0,0,.12); }
.q { width: 40px; height: 40px; border-radius: 10px; background: #f5a800; color: #161310; font-weight: 900; font-size: 24px; display: grid; place-items: center; box-shadow: 0 0 0 3px #fff; }
.ropes { width: 50px; height: 26px; margin: -4px auto 0; border-left: 2px solid #6b5a3a; border-right: 2px solid #6b5a3a; }
.basket { width: 40px; height: 22px; margin: 0 auto; background: #8a5a2b; border-radius: 3px 3px 8px 8px; position: relative; }
.person { position: absolute; left: 12px; top: -14px; width: 16px; height: 16px; border-radius: 50%; background: #f1c27d; box-shadow: 0 -4px 0 -1px #2b2b2b; animation: wave 2.2s ease-in-out infinite; }
.city { position: absolute; bottom: 70px; right: 6%; display: flex; align-items: flex-end; gap: 10px; }
.tower { width: 44px; background: var(--tower); border-radius: 4px 4px 0 0; }
.t1 { height: 120px } .t2 { height: 170px } .t3 { height: 90px }
.office { position: relative; width: 120px; height: 150px; background: #1b3a5c; border-radius: 6px 6px 0 0; }
.windows { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 18px 16px; }
.windows b { height: 14px; border-radius: 2px; background: #f5a800; animation: lights 3s ease-in-out infinite; }
.sign { position: absolute; bottom: 8px; left: 0; right: 0; text-align: center; font-size: 10px; letter-spacing: .2em; color: #f5a800; font-weight: 800; }
.wifi { position: absolute; top: -56px; left: 50%; transform: translateX(-50%); width: 60px; height: 50px; }
.wifi i { position: absolute; left: 50%; bottom: 0; border: 3px solid transparent; border-top-color: #f5a800; border-radius: 50%; transform: translateX(-50%); animation: signal 2s ease-out infinite; opacity: 0; }
.wifi i:nth-child(1) { width: 16px; height: 16px; } .wifi i:nth-child(2) { width: 36px; height: 36px; animation-delay: .3s; } .wifi i:nth-child(3) { width: 56px; height: 56px; animation-delay: .6s; }
.ground { position: absolute; left: 0; right: 0; bottom: 0; height: 72px; background: var(--ground); border-radius: 50% 50% 0 0 / 30px 30px 0 0; }
.card { position: relative; z-index: 2; width: min(460px, 100%); background: var(--card); backdrop-filter: blur(10px); border-radius: 18px; padding: 26px 24px; box-shadow: 0 20px 60px rgba(13,34,56,.25); border: 1px solid rgba(245,168,0,.35); animation: rise .7s ease-out both; }
.eyebrow { margin: 0; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; font-weight: 800; color: #b8860b; }
.dark .eyebrow { color: #f5c542; }
.card h1 { margin: 6px 0 8px; font-size: clamp(20px, 5vw, 26px); line-height: 1.2; font-weight: 900; }
.lead { margin: 0; font-size: 14px; opacity: .85; line-height: 1.5; }
.quip { margin: 12px 0 16px; font-size: 13.5px; font-style: italic; color: #946b00; min-height: 20px; animation: fadein .6s ease both; }
.dark .quip { color: #f5c542; }
form { display: grid; gap: 8px; }
label { font-size: 12px; font-weight: 700; }
input { font: 600 16px ui-monospace, Menlo, Consolas, monospace; letter-spacing: .06em; padding: 12px 14px; border-radius: 10px; border: 1.5px solid rgba(27,58,92,.3); background: rgba(255,255,255,.9); color: #0d2238; outline: none; }
input:focus { border-color: #f5a800; box-shadow: 0 0 0 3px rgba(245,168,0,.25); }
button[type=submit] { padding: 12px; border-radius: 10px; border: 0; background: #f5a800; color: #161310; font-weight: 900; font-size: 15px; cursor: pointer; transition: transform .15s; }
button[type=submit]:hover:not(:disabled) { transform: translateY(-1px); }
button[type=submit]:disabled { opacity: .55; cursor: not-allowed; }
.ok { color: #15803d; font-weight: 700; } .err { color: #b91c1c; font-weight: 700; }
.dark .ok { color: #4ade80; } .dark .err { color: #f87171; }
.links { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 14px; }
.links button { background: none; border: 0; padding: 0; color: inherit; text-decoration: underline; font-size: 13px; cursor: pointer; opacity: .85; }
.small { font-size: 12px; opacity: .7; margin: 12px 0 0; }
.dots { display: inline-flex; gap: 4px; } .dots i { width: 6px; height: 6px; border-radius: 50%; background: #161310; animation: bounce .9s ease-in-out infinite; } .dots i:nth-child(2) { animation-delay: .15s } .dots i:nth-child(3) { animation-delay: .3s }
.confetti i { position: absolute; top: -10px; width: 8px; height: 14px; background: #f5a800; animation: fall 1.4s ease-in forwards; }
.confetti i:nth-child(3n) { background: #1b3a5c } .confetti i:nth-child(3n+1) { background: #4ade80 }
@keyframes drift { from { transform: translateX(-200px) } to { transform: translateX(110vw) } }
@keyframes float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-18px) } }
@keyframes wander { from { left: 6% } to { left: 34% } }
@keyframes fly { from { left: -40px } to { left: 105% } }
@keyframes flap { from { transform: rotate(-25deg) } to { transform: rotate(20deg) } }
@keyframes flap2 { from { transform: rotate(25deg) } to { transform: rotate(-20deg) } }
@keyframes wave { 0%,100% { transform: rotate(0) } 50% { transform: rotate(-12deg) } }
@keyframes signal { 0% { opacity: 0 } 30% { opacity: 1 } 100% { opacity: 0 } }
@keyframes lights { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
@keyframes pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
@keyframes twinkle { from { opacity: .5 } to { opacity: 1 } }
@keyframes rise { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
@keyframes fadein { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
@keyframes bounce { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
@keyframes fall { to { transform: translateY(105vh) rotate(540deg); opacity: .8 } }
@media (max-width: 640px) {
  .away { place-items: end center; padding-top: 210px; }
  .city { right: -20px; transform: scale(.7); transform-origin: bottom right; }
  .balloon { top: 3%; animation: float 7s ease-in-out infinite, wander-sm 24s ease-in-out infinite alternate; }
  .sun { width: 56px; height: 56px; top: 4%; }
}
@keyframes wander-sm { from { left: 4% } to { left: 58% } }
@media (prefers-reduced-motion: reduce) { .away *, .away *::before, .away *::after { animation: none !important; transition: none !important; } }
`;
