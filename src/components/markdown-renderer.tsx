import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

type MarkdownRendererProps = {
  content: string;
};

type ChartSeries = {
  name: string;
  data: number[];
};

type ChartSpec = {
  type: "bar" | "line";
  title: string;
  xAxis: string[];
  series: ChartSeries[];
};

function clampNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function safeText(value: unknown, fallback: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function parseChartSpec(raw: string): ChartSpec | null {
  const source = String(raw || "").trim();
  if (!source) return null;

  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    const type = parsed.type === "line" ? "line" : parsed.type === "bar" ? "bar" : null;
    if (!type) return null;

    const xAxis = Array.isArray(parsed.xAxis)
      ? parsed.xAxis
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 24)
      : [];
    const series = Array.isArray(parsed.series)
      ? parsed.series
          .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return null;
            const payload = item as Record<string, unknown>;
            const name = safeText(payload.name, "series");
            const data = Array.isArray(payload.data)
              ? payload.data.map((value) => clampNumber(value)).slice(0, xAxis.length || 24)
              : [];
            if (data.length === 0) return null;
            return { name, data } satisfies ChartSeries;
          })
          .filter((item): item is ChartSeries => Boolean(item))
      : [];

    if (xAxis.length === 0 || series.length === 0) {
      return null;
    }

    return {
      type,
      title: safeText(parsed.title, "Chart"),
      xAxis,
      series,
    };
  } catch {
    return null;
  }
}

function buildLinePoints(data: number[], maxValue: number, width: number, height: number) {
  const points: string[] = [];
  const denominator = Math.max(1, data.length - 1);
  for (let index = 0; index < data.length; index += 1) {
    const x = 40 + (index / denominator) * (width - 70);
    const y = height - 30 - (data[index] / maxValue) * (height - 65);
    points.push(`${x},${y}`);
  }
  return points.join(" ");
}

function renderBarChart(spec: ChartSpec) {
  const width = 720;
  const height = 320;
  const primary = spec.series[0];
  const values = primary.data.slice(0, spec.xAxis.length);
  const maxValue = Math.max(1, ...values.map((value) => Math.max(0, value)));
  const barWidth = Math.max(14, ((width - 80) / Math.max(1, values.length)) * 0.62);
  const gap = (width - 80) / Math.max(1, values.length);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={spec.title}>
      <line x1="40" y1={height - 30} x2={width - 20} y2={height - 30} stroke="#94a3b8" strokeWidth="1" />
      <line x1="40" y1="20" x2="40" y2={height - 30} stroke="#94a3b8" strokeWidth="1" />

      {values.map((value, index) => {
        const safeValue = Math.max(0, value);
        const barHeight = (safeValue / maxValue) * (height - 65);
        const x = 40 + index * gap + (gap - barWidth) / 2;
        const y = height - 30 - barHeight;
        const label = spec.xAxis[index] || `#${index + 1}`;

        return (
          <g key={`${label}-${index}`}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx="4" fill="#2563eb" opacity="0.92" />
            <text x={x + barWidth / 2} y={height - 12} fontSize="10" textAnchor="middle" fill="#475569">
              {label.slice(0, 8)}
            </text>
            <text x={x + barWidth / 2} y={y - 4} fontSize="10" textAnchor="middle" fill="#1e293b">
              {safeValue}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function renderLineChart(spec: ChartSpec) {
  const width = 720;
  const height = 320;
  const primary = spec.series[0];
  const values = primary.data.slice(0, spec.xAxis.length);
  const maxValue = Math.max(1, ...values.map((value) => Math.max(0, value)));
  const points = buildLinePoints(values.map((value) => Math.max(0, value)), maxValue, width, height);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={spec.title}>
      <line x1="40" y1={height - 30} x2={width - 20} y2={height - 30} stroke="#94a3b8" strokeWidth="1" />
      <line x1="40" y1="20" x2="40" y2={height - 30} stroke="#94a3b8" strokeWidth="1" />
      <polyline fill="none" stroke="#16a34a" strokeWidth="2.2" points={points} />

      {values.map((value, index) => {
        const denominator = Math.max(1, values.length - 1);
        const x = 40 + (index / denominator) * (width - 70);
        const y = height - 30 - (Math.max(0, value) / maxValue) * (height - 65);
        const label = spec.xAxis[index] || `#${index + 1}`;
        return (
          <g key={`${label}-${index}`}>
            <circle cx={x} cy={y} r="3.2" fill="#15803d" />
            <text x={x} y={height - 12} fontSize="10" textAnchor="middle" fill="#475569">
              {label.slice(0, 8)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ChartBlock({ spec }: { spec: ChartSpec }) {
  return (
    <div className="markdown-chart">
      <h4>{spec.title}</h4>
      {spec.type === "line" ? renderLineChart(spec) : renderBarChart(spec)}
    </div>
  );
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const components: Components = {
    code({ className, children, ...props }) {
      const rawContent = Array.isArray(children)
        ? children.map((item) => String(item)).join("")
        : String(children || "");
      const language = String(className || "").replace("language-", "").trim().toLowerCase();
      const isInline = Boolean((props as { inline?: boolean }).inline);
      if (!isInline && language === "chart") {
        const parsed = parseChartSpec(rawContent);
        if (parsed) {
          return <ChartBlock spec={parsed} />;
        }
      }

      return <code className={className}>{children}</code>;
    },
  };

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
