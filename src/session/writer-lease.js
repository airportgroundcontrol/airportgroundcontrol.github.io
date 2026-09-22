// Browser-owned locks are released on tab closure/crash; no racy localStorage leases.
export async function acquireWriter(
  airportId,
  locks = globalThis.navigator?.locks,
) {
  if (!locks) return { status: "unsupported", release() {} };
  let release;
  const lifetime = new Promise((resolve) => {
    release = resolve;
  });
  return new Promise((resolve) => {
    locks
      .request(
        "ground-control:writer:" + airportId,
        { ifAvailable: true },
        async (lock) => {
          resolve({ status: lock ? "owned" : "busy", release });
          if (lock) await lifetime;
        },
      )
      .catch(() => resolve({ status: "unsupported", release() {} }));
  });
}
