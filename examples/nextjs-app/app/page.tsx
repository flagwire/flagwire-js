import { FlagExample } from "./flag-example";

export default function Page() {
  return (
    <main>
      <p className="eyebrow">FlagWire × Next.js</p>
      <h1>Live flags without reloads.</h1>
      <p className="lede">The value below updates when a new environment version is published.</p>
      <FlagExample />
    </main>
  );
}
