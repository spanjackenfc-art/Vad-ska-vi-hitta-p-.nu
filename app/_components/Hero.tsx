export default function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-8">
      <div className="relative overflow-hidden rounded-3xl shadow-xl ring-1 ring-slate-200">
        {/* Background */}
        <div
          className="h-44 sm:h-56 md:h-64"
          style={{
            backgroundImage: "url('/hero/hero-vadskavihittapa-21x9.svg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/70 via-slate-950/35 to-slate-950/10" />
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.45),transparent_55%)]" />

        {/* Content */}
        <div className="absolute inset-0 flex items-end">
          <div className="w-full p-6 sm:p-10">
            <div className="inline-flex items-center rounded-full bg-white/12 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-white/95 backdrop-blur">
              vadskavihittapå.nu
            </div>

            <div className="mt-3 max-w-2xl">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-white">
                Allt som händer. På ett ställe.
              </h1>
              <p className="mt-2 text-sm sm:text-base text-white/85">
                Teater, musik, standup och familj — filtrera på stad och månad och hitta något att göra.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a
                  href="#list"
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-white px-5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-white/90"
                >
                  Se event
                </a>
                <a
                  href="mailto:hello@vadskavihittapa.nu?subject=Tips%20om%20event"
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-white/12 px-5 text-sm font-semibold text-white ring-1 ring-white/20 backdrop-blur hover:bg-white/16"
                >
                  Tipsa om event
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom fade (makes content blend with page) */}
        <div className="absolute -bottom-10 left-0 right-0 h-16 bg-gradient-to-b from-transparent to-slate-50" />
      </div>
    </section>
  );
}
