import React from 'react';
import { Crown, Star, Utensils } from 'lucide-react';
import { SafeImage } from '../common/SafeImage';

interface HeroFoodBannerProps {
  onExploreClick?: () => void;
}

const HERO_BG_IMAGES = [
  '/hero-biryani-handi-hd.jpg',
  '/hero-roast-chicken-hd.jpg',
  '/hero-strawberry-shake-hd.jpg',
  '/hero-falooda-sundae-hd.jpg',
  '/hero-crispy-burger-hd.jpg',
];

export function HeroFoodBanner({ onExploreClick }: HeroFoodBannerProps) {
  const [activeIndex, setActiveIndex] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % HERO_BG_IMAGES.length);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <section
      aria-label="Featured culinary showcase"
      className="relative w-full rounded-2xl sm:rounded-3xl overflow-hidden bg-[#121215] border border-[#26262E] shadow-2xl mb-6 sm:mb-8"
    >
      {/* Background slideshow - auto-rotates every 2 seconds, HD 1600px images */}
      <div className="absolute inset-0 z-0" aria-hidden="true">
        {HERO_BG_IMAGES.map((src, idx) => (
          <SafeImage
            key={src}
            src={src}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full object-cover object-center [image-rendering:auto] filter brightness-[0.82] contrast-110 saturate-110 transition-opacity duration-[1500ms] ease-in-out will-change-opacity ${
              idx === activeIndex ? 'opacity-100' : 'opacity-0'
            }`}
            loading="eager"
            fetchPriority={idx === 0 ? 'high' : 'auto'}
            decoding="async"
            draggable={false}
          />
        ))}
        {/* Cinematic dark gradients */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0C0C0E] via-[#0C0C0E]/85 to-transparent sm:w-2/3" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0C0C0E] via-transparent to-black/30" />
      </div>

      {/* Content overlay */}
      <div className="relative z-10 px-4 py-5 sm:px-8 sm:py-8 lg:px-10 lg:py-10 max-w-2xl flex flex-col items-start justify-center min-h-[220px] sm:min-h-[260px]">
        {/* Royal badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E5A93C]/15 border border-[#E5A93C]/30 text-[#F5C368] text-[11px] font-semibold tracking-wider uppercase mb-2 sm:mb-3 backdrop-blur-sm">
          <Crown className="w-3 h-3 text-[#E5A93C] fill-[#E5A93C]" />
          <span>Great Food | Royal Experience</span>
        </div>

        {/* Hero headline */}
        <h1 className="font-serif-display italic text-2xl sm:text-3xl lg:text-4xl font-medium tracking-tight text-[#FFFFFF] leading-[1.15] mb-2 drop-shadow-md">
          Taste <br className="hidden sm:inline" />
          <span className="text-[#FBBF24] not-italic font-bold tracking-normal font-royal block sm:inline sm:ml-2">
            The Royal Flavours
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-xs sm:text-sm text-[#D1D1DB] font-medium tracking-wide flex items-center gap-2 mb-3.5">
          <span>Fresh Ingredients</span>
          <span className="text-[#E5A93C] font-bold">|</span>
          <span>Premium Taste</span>
        </p>

        {/* Action / Badges */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-[#9E9EAC]">
          <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10 text-[11px]">
            <Star className="w-3 h-3 text-[#E5A93C]" />
            <span className="font-medium text-[#E4E4EC]">Fresh Daily</span>
          </div>

          <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10 text-[11px]">
            <Utensils className="w-3 h-3 text-[#E5A93C]" />
            <span className="font-medium text-[#E4E4EC]">Chef Curated</span>
          </div>

          {onExploreClick && (
            <button
              type="button"
              onClick={onExploreClick}
              className="text-xs font-bold text-[#E5A93C] hover:text-[#FBBF24] transition-colors underline underline-offset-4 ml-1 cursor-pointer"
            >
              Browse All Categories ↓
            </button>
          )}
        </div>

        {/* Auto-slide dots */}
        <div className="flex items-center gap-1.5 mt-4" role="tablist" aria-label="Hero slides">
          {HERO_BG_IMAGES.map((src, idx) => (
            <button
              key={src}
              type="button"
              role="tab"
              aria-selected={idx === activeIndex}
              aria-label={`Go to slide ${idx + 1}`}
              onClick={() => setActiveIndex(idx)}
              className={`h-1.5 rounded-full transition-all duration-500 cursor-pointer ${
                idx === activeIndex ? 'w-6 bg-[#E5A93C]' : 'w-1.5 bg-white/30 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
