import { productName, status } from "../lib/branding";

export default function Home() {
  return (
    <main>
      <h1>{productName}</h1>
      <p>{status}</p>
    </main>
  );
}
