import { IconTile, type IconGlyph } from './IconTile';
import type { LucideIcon } from 'lucide-react';

export interface StepItem {
  title: string;
  description: string;
  glyph?: IconGlyph;
  icon?: LucideIcon;
}

export function StepConnector({
  heading,
  subheading,
  steps,
  numbered = true,
}: {
  heading: string;
  subheading?: string;
  steps: StepItem[];
  numbered?: boolean;
}) {
  const cols = steps.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-5';

  return (
    <section className="py-8 md:py-10">
      <div className="container-main">
        <h2 className="font-heading text-3xl md:text-4xl font-bold text-text-primary text-center md:text-right mb-2">
          {heading}
        </h2>
        {subheading && (
          <p className="text-text-secondary font-normal text-center md:text-right mb-6 max-w-2xl md:mr-0 mx-auto">
            {subheading}
          </p>
        )}
        {!subheading && <div className="mb-5" />}
        <div className="relative">
          <div
            className="hidden md:block absolute top-7 right-[8%] left-[8%] h-[2px] bg-[#D4C8B4]"
            aria-hidden
          />
          <ol className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-5 md:gap-3`}>
            {steps.map((step, i) => (
              <li key={step.title} className="relative flex flex-col items-center text-center">
                <IconTile glyph={step.glyph} icon={step.icon} size="md" className="relative z-10" />
                {numbered && (
                  <p className="mt-4 font-heading text-lg font-bold text-text-primary">
                    الخطوة {i + 1}
                  </p>
                )}
                <p className={`${numbered ? 'mt-1' : 'mt-4'} font-heading text-lg font-bold text-text-primary`}>
                  {step.title}
                </p>
                <p className="mt-1 text-sm text-text-secondary font-normal max-w-[12rem]">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
