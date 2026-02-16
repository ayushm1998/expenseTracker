export type ParsedExpense = {
  amount: number;
  // Optional override: the portion that should count towards *my* spending analytics.
  // If omitted, defaults to `amount`.
  myAmount?: number;
  currency?: string;
  occurredOn?: string; // YYYY-MM-DD
  category?: string;
  note?: string;

  // Optional metadata (set by UI / future parsing)
  card?: string;
  paidBy?: 'me' | 'roommate';
  type?: 'expense' | 'income' | 'transfer' | 'investment' | 'liability' | 'receivable';
  account?: string;
  asset?: string;
  liability?: string;
  counterparty?: string;
  direction?: 'i_lent' | 'i_borrowed' | 'repay' | 'collect';
  splitType?: 'none' | 'equal' | 'ratio';
  splitRatioMe?: number;
  splitRatioOther?: number;
  // Back-compat single counterparty
  otherParty?: string;
  // New: multi-person split counterparts
  otherParties?: string[];

  // If set, this expense was paid by me but fully for someone else.
  // We'll treat it as: myAmount = 0 and they owe me the full amount.
  forPerson?: string;
};

// A lightweight, local-first category template.
// The parser treats the *first* meaningful token as a category when it matches one of these.
// Keep these normalized and stable so charts don’t fragment.
const CATEGORY_WORDS = new Set([
  // Food
  'food',
  'dining',
  'restaurant',

  // Grocery (explicit category keyword only; amount-first messages remain notes)
  'grocery',

  // Housing
  'rent',
  'housing',
  'mortgage',

  // Transport / travel
  'travel',
  'transport',
  'transit',
  'cab',
  'uber',
  'lyft',
  'ola',
  'taxi',
  'flight',
  'hotel',
  'parking',
  'toll',
  'fuel',
  'gas',
  // Bay Area examples
  'clipper',
  'bart',
  'muni',
  'caltrain',

  // Utilities & recurring
  'bills',
  'utilities',
  'electric',
  'water',
  'internet',
  'phone',
  'subscription',
  'subscriptions',
  'netflix',
  'spotify',
  'youtube',
  'apple',

  // Lifestyle
  'shopping',
  // Common retailers (map to shopping)
  'walmart',
  'amazon',
  'dollartree',
  'dollar-tree',
  'dollar_tree',
  'dollar',
  'entertainment',
  'movies',
  'movie',
  'comedy',
  'show',
  'shows',

  // Health
  'health',
  'medical',
  'pharmacy',

  // Other common
  'education',
  'gifts',
]);

function normalizeCategory(cat: string): string {
  const c = String(cat || '').trim().toLowerCase();
  if (!c) return c;

  // Shopping / retailer synonyms
  if (
    c === 'walmart' ||
    c === 'amazon' ||
    c === 'dollartree' ||
    c === 'dollar-tree' ||
    c === 'dollar_tree'
  )
    return 'shopping';

  // Grocery synonyms
  if (c === 'groceries') return 'grocery';

  // Housing
  if (c === 'mortgage') return 'housing';

  // Transport synonyms
  if (c === 'cab' || c === 'uber' || c === 'lyft' || c === 'ola' || c === 'taxi') return 'transport';

  // Transit systems / stored value
  if (c === 'clipper' || c === 'bart' || c === 'muni' || c === 'caltrain') return 'travel';

  // Food synonyms
  if (c === 'restaurant') return 'dining';

  // Entertainment synonyms
  if (c === 'movie' || c === 'movies' || c === 'comedy' || c === 'show' || c === 'shows') return 'entertainment';

  // Utilities / recurring
  if (c === 'electric' || c === 'water' || c === 'internet' || c === 'phone') return 'utilities';
  if (c === 'subscription' || c === 'subscriptions' || c === 'netflix' || c === 'spotify' || c === 'youtube') return 'subscriptions';

  return c;
}

function normalize(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u20B9]/g, '₹');
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateToken(text: string): { occurredOn?: string; cleaned: string } {
  let cleaned = text;

  // ISO date: 2026-02-05
  const iso = cleaned.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const occurredOn = `${iso[1]}-${iso[2]}-${iso[3]}`;
    cleaned = cleaned.replace(iso[0], '').trim();
    return { occurredOn, cleaned };
  }

  // Slash formats: 05/02/2026 or 5/2/2026 (assume DD/MM/YYYY)
  const slash = cleaned.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slash) {
    const dd = Number(slash[1]);
    const mm = Number(slash[2]);
    const yyyy = Number(slash[3]);
    const d = new Date(yyyy, mm - 1, dd);
    if (!Number.isNaN(d.getTime())) {
      const occurredOn = toYmd(d);
      cleaned = cleaned.replace(slash[0], '').trim();
      return { occurredOn, cleaned };
    }
  }

  // Keywords: yesterday / today
  if (/\byesterday\b/i.test(cleaned)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    cleaned = cleaned.replace(/\byesterday\b/gi, '').trim();
    return { occurredOn: toYmd(d), cleaned };
  }
  if (/\btoday\b/i.test(cleaned)) {
    const d = new Date();
    cleaned = cleaned.replace(/\btoday\b/gi, '').trim();
    return { occurredOn: toYmd(d), cleaned };
  }

  return { cleaned };
}

function extractMetaTokens(text: string): {
  cleaned: string;
  card?: string;
  paidBy?: 'me' | 'roommate';
  forPerson?: string;
  splitType?: 'none' | 'equal' | 'ratio';
  splitRatioMe?: number;
  splitRatioOther?: number;
  otherParty?: string;
  otherParties?: string[];
  type?: 'expense' | 'income' | 'transfer' | 'investment' | 'liability' | 'receivable';
  account?: string;
  asset?: string;
  liability?: string;
  counterparty?: string;
  direction?: 'i_lent' | 'i_borrowed' | 'repay' | 'collect';
} {
  const tokens = text.split(' ').filter(Boolean);

  let card: string | undefined;
  let paidBy: 'me' | 'roommate' | undefined;
  let forPerson: string | undefined;
  let splitType: 'none' | 'equal' | 'ratio' = 'none';
  let splitRatioMe: number | undefined;
  let splitRatioOther: number | undefined;
  let otherParty: string | undefined;
  const otherPartiesRaw: string[] = [];
  let type: 'expense' | 'income' | 'transfer' | 'investment' | 'liability' | 'receivable' | undefined;
  let account: string | undefined;
  let asset: string | undefined;
  let liability: string | undefined;
  let counterparty: string | undefined;
  let direction: 'i_lent' | 'i_borrowed' | 'repay' | 'collect' | undefined;

  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const lower = t.toLowerCase();

    const mCard = lower.match(/^card:(.+)$/);
    if (mCard) {
      card = mCard[1];
      continue;
    }

  const mType = lower.match(/^type:(expense|income|transfer|investment|liability|receivable)$/);
    if (mType) {
      type = mType[1] as typeof type;
      continue;
    }

    const mAccount = lower.match(/^(?:acct|account):(.+)$/);
    if (mAccount) {
      account = mAccount[1];
      continue;
    }

    const mAsset = lower.match(/^(?:asset|inv|investment):(.+)$/);
    if (mAsset) {
      asset = mAsset[1];
      continue;
    }

    const mLiab = lower.match(/^(?:liab|liability):(.+)$/);
    if (mLiab) {
      liability = mLiab[1];
      continue;
    }

    const mCounterparty = lower.match(/^(?:cp|counterparty|person):(.+)$/);
    if (mCounterparty) {
      counterparty = mCounterparty[1];
      continue;
    }

    const mDir = lower.match(/^(?:dir|direction):(i_lent|i_borrowed|repay|collect)$/);
    if (mDir) {
      direction = mDir[1] as typeof direction;
      continue;
    }

    const mPaidBy = lower.match(/^paidby:(me|roommate)$/);
    if (mPaidBy) {
      paidBy = mPaidBy[1] as 'me' | 'roommate';
      continue;
    }

    const mFor = lower.match(/^(?:for|owner):(.+)$/);
    if (mFor) {
      forPerson = mFor[1].trim();
      continue;
    }

    const mOther = lower.match(/^other:(.+)$/);
    if (mOther) {
      const raw = mOther[1];
      const parts = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length) {
        for (const p of parts) otherPartiesRaw.push(p);
      }
      otherParty = otherParty ?? parts[0];
      continue;
    }

    // Preferred split syntax (emitted by the web UI / editor):
    //   split:equal
    //   split:2/1
    const mSplit = lower.match(/^split:(.+)$/);
    if (mSplit) {
      const v = mSplit[1];
      if (v === 'equal') {
        splitType = 'equal';
      } else if (/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(v)) {
        const [a, b] = v.split('/').map((x) => Number(x));
        if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
          splitType = 'ratio';
          splitRatioMe = a;
          splitRatioOther = b;
        } else {
          splitType = 'equal';
        }
      } else {
        // Unknown value: treat like equal rather than breaking parsing.
        splitType = 'equal';
      }
      continue;
    }

    if (lower === 'split') {
      // Optional next token can be a ratio like 50/50 or 70/30
      splitType = 'equal';
      const next = tokens[i + 1];
      if (next && /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(next)) {
        const [a, b] = next.split('/').map((x) => Number(x));
        if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
          splitType = 'ratio';
          splitRatioMe = a;
          splitRatioOther = b;
        }
        i++; // consume ratio token
      }
      continue;
    }

    kept.push(t);
  }

  const otherParties = Array.from(
    new Map(
      otherPartiesRaw
        .map((s) => String(s).trim())
        .filter(Boolean)
        .map((s) => [s.toLowerCase(), s] as const)
    ).values()
  );

  return {
    cleaned: kept.join(' '),
    card,
    paidBy,
    forPerson,
    splitType,
    splitRatioMe,
    splitRatioOther,
    otherParty,
    otherParties: otherParties.length ? otherParties : undefined,
    type,
    account,
    asset,
    liability,
    counterparty,
    direction,
  };
}

/**
 * Parses free-form SMS/WhatsApp-like text into an expense.
 * Supported examples:
 *  - "food 250 chai"
 *  - "spent 250 chai"
 *  - "+1200 rent"
 *  - "250" (note optional)
 */
export function parseExpenseMessage(textRaw: string): ParsedExpense | null {
  const normalized = normalize(textRaw);
  const meta = extractMetaTokens(normalized);
  const { occurredOn, cleaned: text } = parseDateToken(meta.cleaned);
  if (!text) return null;

  // Currency: we only support USD for this app.
  // (If you ever want INR again, we can reintroduce it alongside conversion.)
  const currency = 'USD';

  // Find the first number with optional decimal separators and commas.
  const match = text.match(/(?:\$|usd\s*)?([0-9]+(?:,[0-9]{3})*)(?:\.(\d{1,2}))?/i);
  if (!match) return null;

  const intPart = match[1].replace(/,/g, '');
  const decPart = match[2];
  const amount = Number(decPart ? `${intPart}.${decPart}` : intPart);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const before = text.slice(0, match.index ?? 0).trim();
  const after = text.slice((match.index ?? 0) + match[0].length).trim();

  const STOPWORD = /^(spent|spend|paid|pay|for|on|rs\.?|₹|inr)$/i;

  // If the user message is like "spent 250 chai", `before` is just a stopword.
  // In that case, use only the text after the amount for note/category.
  const beforeTokens = before.split(' ').filter(Boolean).filter((t) => !STOPWORD.test(t));
  const candidateText = (beforeTokens.length === 0 ? after : `${before} ${after}`)
    .trim()
    .replace(/\s+/g, ' ');

  const tokens = candidateText.split(' ').filter(Boolean);
  const filtered = tokens.filter((t) => !STOPWORD.test(t));

  let category: string | undefined;
  let note: string | undefined;

  if (filtered.length > 0) {
    const first = filtered[0].toLowerCase();
    if (CATEGORY_WORDS.has(first)) {
      category = normalizeCategory(first);
      note = filtered.slice(1).join(' ') || undefined;
    } else {
      note = filtered.join(' ') || undefined;
    }
  }

  return {
    amount,
    currency,
    occurredOn,
    category,
    note,

    forPerson: meta.forPerson,

    card: meta.card,
    paidBy: meta.paidBy,
    splitType: meta.splitType,
    splitRatioMe: meta.splitRatioMe,
    splitRatioOther: meta.splitRatioOther,
    otherParty: meta.otherParty,
    otherParties: meta.otherParties,
    type: meta.type ?? 'expense',
    account: meta.account,
    asset: meta.asset,
    liability: meta.liability,
    counterparty: meta.counterparty,
    direction: meta.direction,
  };
}
