// Link scoring utilities implementing the design spec
// score = 0.6*semantic + 0.2*entity_score + 0.15*tag_score + 0.05*(reference+temporal+session)
// guardrail: if (semantic < 0.35 && entity_score < 0.20) score *= 0.5
// thresholds: keep if score >= 0.55; suggest if 0.45 <= score < 0.55

import { toEntityMap, weightedJaccard, topIntersect } from './entities';
import { computeTagScore } from './tags';

export type StructuralSignals = {
  reference_score?: number; // 0..1 tiny boost if A mentions B's title/id/url
  temporal_score?: number;  // 0..1 tiny boost if edited same 24h and share ≥1 entity/tag
  session_score?: number;   // 0..1 tiny boost if created in same session
};

export type CandidateExplain = {
  cosines: number[];           // top cosines (up to 3)
  shared_entities: string[];   // top overlap entities (canonical)
  shared_tags: string[];       // set intersection of tags
};

export type FeatureInputs = {
  // semantic
  top5_cosines: number[]; // 0..1 values
  // entities
  entitiesA: Array<{ entity: string; weight?: number }>; // pre-normalized optional weights
  entitiesB: Array<{ entity: string; weight?: number }>;
  // tags
  tagsA: string[];
  tagsB: string[];
  // optional tag idf for BM25
  tagIdf?: Record<string, number>;
  // structural
  structural?: StructuralSignals;
  // semantic aggregation method
  aggregate?: 'mean' | 'max';
};

export type FeatureScores = {
  semantic: number;      // 0..1
  entity_score: number;  // 0..1
  tag_score: number;     // 0..1
  reference_score: number; // 0..1
  temporal_score: number;  // 0..1
  session_score: number;   // 0..1
};

export function aggregateSemantic(top: number[], method: 'mean' | 'max' = 'mean'): number {
  const vals = (top || []).filter((x) => Number.isFinite(x));
  if (vals.length === 0) return 0;
  if (method === 'max') return Math.max(...vals);
  const sum = vals.reduce((a, b) => a + b, 0);
  return Math.min(1, Math.max(0, sum / vals.length));
}

export function computeEntityScore(entitiesA: Array<{ entity: string; weight?: number }>, entitiesB: Array<{ entity: string; weight?: number }>): number {
  const A = toEntityMap(entitiesA);
  const B = toEntityMap(entitiesB);
  return weightedJaccard(A, B);
}

export function computeTagFeature(tagsA: string[], tagsB: string[], tagIdf?: Record<string, number>): number {
  return computeTagScore(tagsA, tagsB, { idf: tagIdf });
}

export function computeFeatureScores(input: FeatureInputs): FeatureScores {
  const semantic = aggregateSemantic(input.top5_cosines, input.aggregate ?? 'mean');
  const entity_score = computeEntityScore(input.entitiesA, input.entitiesB);
  const tag_score = computeTagFeature(input.tagsA, input.tagsB, input.tagIdf);
  const reference_score = clamp01(input.structural?.reference_score ?? 0);
  const temporal_score = clamp01(input.structural?.temporal_score ?? 0);
  const session_score = clamp01(input.structural?.session_score ?? 0);
  return { semantic, entity_score, tag_score, reference_score, temporal_score, session_score };
}

export function finalLinkScore(f: FeatureScores): number {
  let score = 0.6 * f.semantic + 0.2 * f.entity_score + 0.15 * f.tag_score + 0.05 * (f.reference_score + f.temporal_score + f.session_score);
  if (f.semantic < 0.35 && f.entity_score < 0.2) score *= 0.5; // guardrail
  return clamp01(score);
}

export type LinkDecision = 'hard' | 'soft' | 'none';

export function classifyLink(score: number): LinkDecision {
  if (score >= 0.55) return 'hard';
  if (score >= 0.45) return 'soft';
  return 'none';
}

export function buildExplain(input: FeatureInputs): CandidateExplain {
  const cosines = (input.top5_cosines || []).slice(0, 3);
  const A = toEntityMap(input.entitiesA);
  const B = toEntityMap(input.entitiesB);
  const shared_entities = topIntersect(A, B, 5);
  const shared_tags = Array.from(tagIntersection(input.tagsA, input.tagsB));
  return { cosines, shared_entities, shared_tags };
}

export function tagIntersection(a: string[] = [], b: string[] = []): Set<string> {
  const A = new Set(a);
  const B = new Set(b);
  const out = new Set<string>();
  for (const t of A) if (B.has(t)) out.add(t);
  return out;
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
