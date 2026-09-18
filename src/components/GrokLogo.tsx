import { IconBolt } from "@/components/icons";

/**
 * Supercharge product mark.
 *
 * The historical component name stays as an internal compatibility detail so
 * existing imports do not need to churn while the visible product surface is
 * provider-neutral.
 */
export function GrokLogo({ size = 22 }: { size?: number }) {
  return <IconBolt size={size} className="grok-logo" title="Supercharge" />;
}
