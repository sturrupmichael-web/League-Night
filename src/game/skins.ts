/**
 * Skins against one rival. Each hole is worth one skin.
 *  - carry: a tied hole carries its pot to the next hole. A tie on the final hole voids the pot.
 *  - sudden: a tied hole's skin is simply lost.
 */
export type SkinsRule = 'carry' | 'sudden';

export interface SkinsHole {
  winner: 'you' | 'rival' | 'tie';
  /** Skins on the line this hole (1 + carried). */
  pot: number;
  /** Skins this hole paid out (0 on a tie). */
  paid: number;
}

export interface SkinsTally {
  holes: SkinsHole[];
  you: number;
  rival: number;
  /** Skins riding into the next hole. */
  carry: number;
  /** Skins voided by a tie on the final hole. */
  voided: number;
}

export function tallySkins(you: number[], rival: number[], rule: SkinsRule, totalHoles: number): SkinsTally {
  const holes: SkinsHole[] = [];
  let carry = 0;
  let y = 0;
  let r = 0;
  let voided = 0;
  const n = Math.min(you.length, rival.length);
  for (let i = 0; i < n; i++) {
    const pot = 1 + (rule === 'carry' ? carry : 0);
    const winner = you[i] < rival[i] ? 'you' : you[i] > rival[i] ? 'rival' : 'tie';
    let paid = 0;
    if (winner === 'you') {
      y += pot;
      paid = pot;
      carry = 0;
    } else if (winner === 'rival') {
      r += pot;
      paid = pot;
      carry = 0;
    } else if (rule === 'carry') {
      if (i === totalHoles - 1) {
        voided = pot;
        carry = 0;
      } else carry = pot;
    }
    holes.push({ winner, pot, paid });
  }
  return { holes, you: y, rival: r, carry, voided };
}

/** Can the trailing player still catch up? (Used to end a match early is NOT done: we always play it out.) */
export function skinsOutcome(t: SkinsTally): 'you' | 'rival' | 'halved' {
  return t.you > t.rival ? 'you' : t.rival > t.you ? 'rival' : 'halved';
}
