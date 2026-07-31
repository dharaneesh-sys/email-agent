// Importance scoring engine for emails
// Implements rule-based scoring to determine email importance

import type { Email } from './types';
import { IMPORTANCE_RULES } from './config';

interface ScoringBreakdown {
  sender: number;
  keywords: number;
  recency: number;
  threadParticipation: number;
  directToYou: number;
  ccPenalty: number;
  total: number;
}

export class ImportanceScorer {
  /**
   * Calculate importance score for an email
   */
  scoreEmail(email: Email, accountEmail: string): { 
    score: number; 
    isImportant: boolean;
    reasons: string[];
    breakdown: ScoringBreakdown;
  } {
    const breakdown: ScoringBreakdown = {
      sender: 0,
      keywords: 0,
      recency: 0,
      threadParticipation: 0,
      directToYou: 0,
      ccPenalty: 0,
      total: 0,
    };

    const reasons: string[] = [];

    // 1. Sender scoring
    const senderScore = this.scoreSender(email);
    breakdown.sender = senderScore;
    if (senderScore > 0) {
      reasons.push(`From important sender (+${senderScore})`);
    } else if (senderScore < 0) {
      reasons.push(`From low-priority sender (${senderScore})`);
    }

    // 2. Keyword scoring
    const keywordScore = this.scoreKeywords(email);
    breakdown.keywords = keywordScore;
    if (keywordScore > 0) {
      reasons.push(`Contains important keywords (+${keywordScore})`);
    } else if (keywordScore < 0) {
      reasons.push(`Contains low-priority keywords (${keywordScore})`);
    }

    // 3. Recency scoring
    const recencyScore = this.scoreRecency(email);
    breakdown.recency = recencyScore;
    if (recencyScore > 0) {
      reasons.push(`Recent email (+${recencyScore})`);
    }

    // 4. Thread participation (if we've replied in this thread)
    // For now, we'll assume we need to check against sent mail - simplified
    // In a full implementation, we'd check if our email address is in the thread's sent messages
    breakdown.threadParticipation = 0; // Placeholder

    // 5. Direct to you vs CC/BCC
    const { direct, cc } = this.scoreRecipients(email, accountEmail);
    breakdown.directToYou = direct;
    breakdown.ccPenalty = cc;
    if (direct > 0) {
      reasons.push(`Directly addressed to you (+${direct})`);
    }
    if (cc < 0) {
      reasons.push(`CC'd email (${cc})`);
    }

    // Calculate total
    breakdown.total = 
      breakdown.sender +
      breakdown.keywords +
      breakdown.recency +
      breakdown.threadParticipation +
      breakdown.directToYou +
      breakdown.ccPenalty;

    // Determine if important (threshold can be configured)
    const isImportant = breakdown.total > 0;

    return {
      score: Math.max(0, breakdown.total), // Don't show negative scores in UI
      isImportant,
      reasons,
      breakdown,
    };
  }

  /**
   * Score based on sender domain/email
   */
  private scoreSender(email: Email): number {
    const fromHeader = this.getHeader(email.payload.headers, 'From');
    if (!fromHeader) return 0;

    // Extract email address
    const emailMatch = fromHeader.match(/<([^>]+)>/);
    const senderEmail = emailMatch?.[1] ?? fromHeader.trim();

    // Extract domain
    const parts = senderEmail.split('@');
    const domainMatch = parts[1];
    if (!domainMatch) return 0;

    // Check if domain is in our scoring list
    const scores: Record<string, number> = IMPORTANCE_RULES.SENDER_SCORES;
    return scores[domainMatch] ?? 0;
  }

  /**
   * Score based on keywords in subject and body
   */
  private scoreKeywords(email: Email): number {
    let score = 0;
    const snippet = (email.snippet || '').toLowerCase();
    const subject = this.getHeader(email.payload.headers, 'Subject')?.toLowerCase() ?? '';

    // Check positive keywords
    for (const [keyword, points] of Object.entries(IMPORTANCE_RULES.KEYWORD_SCORES)) {
      if (subject.includes(keyword) || snippet.includes(keyword)) {
        score += points;
      }
    }

    // Check negative keywords
    for (const [keyword, points] of Object.entries(IMPORTANCE_RULES.NEGATIVE_KEYWORDS)) {
      if (subject.includes(keyword) || snippet.includes(keyword)) {
        score += points; // points are already negative
      }
    }

    return score;
  }

  /**
   * Score based on how recent the email is
   */
  private scoreRecency(email: Email): number {
    const timestampMs = parseInt(email.internalDate, 10);
    if (isNaN(timestampMs)) return 0;

    const hoursAgo = (Date.now() - timestampMs) / (1000 * 60 * 60);

    // Check against our recency buckets
    if (hoursAgo <= 1) return IMPORTANCE_RULES.RECENCY_BONUS['1h'] ?? 20;
    if (hoursAgo <= 6) return IMPORTANCE_RULES.RECENCY_BONUS['6h'] ?? 15;
    if (hoursAgo <= 24) return IMPORTANCE_RULES.RECENCY_BONUS['24h'] ?? 10;
    if (hoursAgo <= 168) return IMPORTANCE_RULES.RECENCY_BONUS['7d'] ?? 5; // 7 days

    return 0;
  }

  /**
   * Score based on recipients (To, CC, BCC)
   * Returns object with direct and cc scores
   */
  private scoreRecipients(email: Email, accountEmail: string): {
    direct: number;
    cc: number;
  } {
    const toHeader = this.getHeader(email.payload.headers, 'To') || '';
    const ccHeader = this.getHeader(email.payload.headers, 'Cc') || '';

    const toAddresses = this.extractAddresses(toHeader);
    const ccAddresses = this.extractAddresses(ccHeader);

    let directScore = 0;
    let ccScore = 0;

    // Check if we're directly in To
    if (toAddresses.some(addr => addr.toLowerCase() === accountEmail.toLowerCase())) {
      directScore = IMPORTANCE_RULES.DIRECT_TO_YOU_BOOST;
    }

    // Check if we're in CC
    if (ccAddresses.some(addr => addr.toLowerCase() === accountEmail.toLowerCase())) {
      ccScore = IMPORTANCE_RULES.CC_PENALTY;
    }

    return { direct: directScore, cc: ccScore };
  }

  /**
   * Extract email addresses from a header like "Name <email@domain.com>, Another <another@test.com>"
   */
  private extractAddresses(header: string): string[] {
    if (!header) return [];
    // Simple regex to extract email addresses
    const emailRegex = /<([^>]+)>/g;
    return [...header.matchAll(emailRegex)].map(m => (m[1] ?? '').toLowerCase().trim()).filter(Boolean);
  }

  /**
   * Helper to get header value by name (case-insensitive)
   */
  private getHeader(headers: { name: string; value: string }[], name: string): string | null {
    const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : null;
  }
}

// Export singleton instance
export const importanceScorer = new ImportanceScorer();