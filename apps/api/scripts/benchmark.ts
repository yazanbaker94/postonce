import { performance } from "node:perf_hooks";

const DATASET_SIZE = 50_000;
const LOOKUPS = 20_000;
const invoices = Array.from({ length: DATASET_SIZE }, (_, index) => ({
  repairOrderNumber: `RO-${String(index + 1).padStart(6, "0")}`,
  amountCents: 10_000 + (index % 90_000),
}));
const index = new Map(invoices.map((invoice) => [invoice.repairOrderNumber, invoice]));
const target = `RO-${String(DATASET_SIZE - 7).padStart(6, "0")}`;

function measure(operation: () => unknown, runs: number): number {
  const started = performance.now();
  for (let run = 0; run < runs; run += 1) operation();
  return ((performance.now() - started) * 1_000) / runs;
}

// Warm the runtime before recording the deterministic synthetic comparison.
measure(() => index.get(target), 2_000);
measure(() => invoices.find((invoice) => invoice.repairOrderNumber === target), 50);

const indexedLookupMicros = measure(() => index.get(target), LOOKUPS);
const sequentialScanMicros = measure(
  () => invoices.find((invoice) => invoice.repairOrderNumber === target),
  Math.max(100, Math.floor(LOOKUPS / 100)),
);

if (!index.get(target) || !invoices.find((invoice) => invoice.repairOrderNumber === target)) {
  throw new Error("Benchmark fixture lookup failed");
}

console.log(JSON.stringify({
  fixture: "synthetic repair-order references",
  datasetSize: DATASET_SIZE,
  indexedLookup: { complexity: "O(1) expected", averageMicros: Number(indexedLookupMicros.toFixed(3)) },
  sequentialScan: { complexity: "O(n)", averageMicros: Number(sequentialScanMicros.toFixed(3)) },
  note: "Wall-clock values vary by machine; the algorithmic comparison is the evidence.",
}, null, 2));
