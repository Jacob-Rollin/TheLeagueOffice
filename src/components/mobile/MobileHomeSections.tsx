import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { LeagueAvatar } from "@/components/league/LeagueAvatar";
import type { ActiveLeagueToken } from "@/context/ActiveLeagueContext";
import { listPublishedArticles } from "@/lib/articles";
import { fetchEspnNflNewsJson } from "@/lib/espn-public-client";

import { MobileCard, MobileSectionTitle } from "./MobileShell";

const ctaClass =
  "block w-full rounded-lg bg-m-cta px-4 py-3.5 text-center font-display text-lg font-extrabold italic uppercase tracking-wider text-m-cta-fg shadow-[0_3px_0_rgba(0,0,0,0.25)] transition-transform active:translate-y-px";

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: "Sleeper",
  espn: "ESPN",
  yahoo: "Yahoo",
};

export function MobileJoinHero() {
  return (
    <section className="relative overflow-hidden">
      <img
        src="/football-yard-line.jpg"
        alt=""
        className="absolute inset-0 size-full object-cover grayscale"
        aria-hidden="true"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundImage: "linear-gradient(180deg, var(--m-hero-from) 0%, var(--m-hero-to) 70%)" }}
      />
      <div className="relative z-10 flex flex-col items-center px-6 pb-8 pt-40 text-center text-white">
        <h1 className="font-display text-[34px] font-bold leading-tight tracking-wide drop-shadow">
          The League Is Back
        </h1>
        <p className="mt-1 text-sm text-white/90">Join a league or start your own now!</p>
        <Link to="/leaguesync" className={`${ctaClass} mt-8`}>
          Join a League
        </Link>
        <Link
          to="/leaguesync"
          className="mt-3 block w-full rounded-lg bg-black/10 px-4 py-3.5 text-center font-display text-lg font-semibold tracking-wide text-white transition-colors hover:bg-black/20"
        >
          Create a League
        </Link>
      </div>
    </section>
  );
}

export function MobileMyLeagues({ leagues }: { leagues: ActiveLeagueToken[] }) {
  return (
    <>
      <MobileSectionTitle>My Leagues</MobileSectionTitle>
      <div className="space-y-3">
        {leagues.map((league) => (
          <MobileLeagueCard key={league.id} league={league} />
        ))}
      </div>
      <div className="mx-4 mt-3">
        <Link
          to="/leaguesync"
          className="block w-full rounded-lg bg-m-chip px-4 py-3 text-center font-display text-sm font-bold uppercase tracking-widest text-m-chip-fg"
        >
          Sync Another League
        </Link>
      </div>
    </>
  );
}

function MobileLeagueCard({ league }: { league: ActiveLeagueToken }) {
  const platform = PLATFORM_LABELS[league.platform.toLowerCase()] ?? league.platform;

  return (
    <MobileCard>
      <Link to="/m/league/$leagueId" params={{ leagueId: league.id }} className="block w-full text-center">
        <div className="flex flex-col items-center px-4 pb-4 pt-5">
          <LeagueAvatar
            platform={league.platform}
            src={league.avatar}
            alt=""
            className="size-16 max-h-16 max-w-16"
          />
          <p className="mt-3 font-display text-2xl font-bold leading-tight">
            {league.teamName ?? "My Team"}
          </p>
          <p className="mt-1 font-display text-sm font-semibold uppercase tracking-widest text-m-muted">
            {league.name}
          </p>
        </div>
        <div className="border-t border-m-border px-4 py-3.5 text-sm text-m-card-fg/90">
          Synced from {platform}. Tap to open your league.
        </div>
      </Link>
    </MobileCard>
  );
}

export function MobileMockDraftCard() {
  return (
    <MobileCard className="mt-3 p-5">
      <h2 className="font-display text-xl font-bold tracking-wide">Mock Draft Lobby</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-m-card-fg/85">
        Practice your draft strategy against AI managers before the real thing.
      </p>
      <Link
        to="/mock-draft/setup"
        className="mt-5 block w-full rounded-lg bg-m-chip px-4 py-3 text-center font-display text-base font-bold uppercase tracking-widest text-m-chip-fg"
      >
        Mock Drafts
      </Link>
    </MobileCard>
  );
}

type TrendingItem = {
  key: string;
  title: string;
  image: string | null;
  date: string | null;
  href: { internal: string } | { external: string };
};

type EspnNewsItem = {
  headline: string;
  published?: string;
  images?: { url: string }[];
  links?: { web?: { href?: string } };
  categories?: { description?: string }[];
};

async function loadTrending(): Promise<TrendingItem[]> {
  const [articles, news] = await Promise.all([
    listPublishedArticles(4).catch(() => []),
    fetchEspnNflNewsJson(50)
      .then((d) => (d.articles ?? []) as EspnNewsItem[])
      .catch(() => [] as EspnNewsItem[]),
  ]);

  const fromArticles: TrendingItem[] = articles.map((a) => ({
    key: `article-${a.id}`,
    title: a.title,
    image: a.image_url || null,
    date: a.created_at,
    href: { internal: a.slug },
  }));

  const fromNews: TrendingItem[] = news
    .filter((n) =>
      (n.categories ?? []).some((c) => (c.description ?? "").toLowerCase().includes("fantasy")) ||
      n.headline.toLowerCase().includes("fantasy"),
    )
    .filter((n) => Boolean(n.links?.web?.href))
    .map((n, i) => ({
      key: `espn-${i}`,
      title: n.headline,
      image: n.images?.[0]?.url ?? null,
      date: n.published ?? null,
      href: { external: n.links?.web?.href ?? "" },
    }));

  return [...fromArticles, ...fromNews].slice(0, 8);
}

const formatDate = (iso: string | null) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};

export function MobileTrending() {
  const { data: items = [], isPending } = useQuery({
    queryKey: ["mobile-trending"],
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: loadTrending,
  });

  return (
    <>
      <MobileSectionTitle>Trending Now</MobileSectionTitle>
      {isPending ? (
        <p className="px-5 pb-8 text-sm text-m-muted">Loading headlines...</p>
      ) : items.length === 0 ? (
        <p className="px-5 pb-8 text-sm text-m-muted">Headlines will appear here when available.</p>
      ) : (
        <div className="space-y-4 pb-10">
          {items.map((item) => (
            <TrendingCard key={item.key} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

function TrendingCard({ item }: { item: TrendingItem }) {
  const date = formatDate(item.date);
  const body = (
    <>
      {item.image ? (
        <img src={item.image} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
      ) : null}
      <div className="bg-m-card px-4 pb-4 pt-3 text-m-card-fg">
        <h3 className="font-display text-[26px] font-bold leading-tight">{item.title}</h3>
        {date ? <p className="mt-2 text-sm text-m-muted">{date}</p> : null}
      </div>
    </>
  );

  const className = "block overflow-hidden";

  return "internal" in item.href ? (
    <Link to="/articles/$slug" params={{ slug: item.href.internal }} className={className}>
      {body}
    </Link>
  ) : (
    <a href={item.href.external} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  );
}
