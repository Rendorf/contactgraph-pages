export function GenerationDataNotice({ includeNotes, onChange, disabled = false }: {
  includeNotes: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  return <div className="my-3 space-y-2 text-sm text-slate-700">
    <p>Generating sends the selected names, roles, organizations, address preferences, occasion and your guidance to OpenAI. Drafts are saved in ContactGraph.</p>
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <input type="checkbox" checked={includeNotes} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-5 shrink-0" />
      <span>Also include saved contact notes for this request. Notes may contain sensitive information.</span>
    </label>
  </div>;
}

export function ExternalDataNotice() {
  return <section className="rounded-xl border bg-white p-5 text-sm text-slate-700" aria-label="External services and your data">
    <h2 className="mb-2 font-semibold text-slate-950">External services and your data</h2>
    <p>Message generation sends selected contact context, occasion details and any guidance you enter to OpenAI. Saved notes are excluded unless you opt in for that request. API keys stay on the server.</p>
    <p className="mt-2">OSINT searches send names and search terms to the configured search services. Profile and feed lookups contact the selected websites. Enable monitoring only for contacts you choose. Review findings before adding them to a contact.</p>
    <p className="mt-2">The shared web app stores records and photos in Firebase. Trusted-device offline access keeps a copy in this browser; sign out and discard local data before sharing the device.</p>
  </section>;
}
