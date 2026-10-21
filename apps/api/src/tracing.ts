/**
 * OpenTelemetry bootstrap. Imported first in main.ts so HTTP/Prisma/Redis
 * instrumentation can patch libraries before Nest loads them.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const enabled = process.env.OTEL_ENABLED === 'true';
let sdk: NodeSDK | null = null;

if (enabled) {
  const endpoint = (
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:4318'
  ).replace(/\/$/, '');
  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'smart-table-api',
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? `${endpoint}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });
  sdk.start();
  // eslint-disable-next-line no-console
  console.log(`[otel] tracing enabled -> ${endpoint}`);
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown().catch(() => undefined);
    sdk = null;
  }
}

process.once('SIGTERM', () => {
  void shutdownTracing();
});
process.once('SIGINT', () => {
  void shutdownTracing();
});
