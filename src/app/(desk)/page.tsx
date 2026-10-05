import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Desk",
};

export default function DeskPage() {
  return (
    <section className="max-w-3xl">
      <p className="font-mono text-xs tracking-[0.18em] text-mist uppercase">Overview</p>
      <h2 className="font-display mt-3 text-4xl leading-none font-medium tracking-tight sm:text-6xl">
        The desk is open.
      </h2>
      <p className="mt-6 max-w-xl text-lg leading-8 text-mist">
        Drafts and published posts for the portfolio will be written from here.
      </p>
    </section>
  );
}
