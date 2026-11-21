# Legitimate interests assessment: fair-play connection tags

**Processing:** when a player starts or finishes the daily puzzle, saves an account or signs in, the server stores a tag: a SHA-256 hash of their IP address combined with a random secret that changes every day. It's stored with the player ID, the date and what happened. Tags are deleted after 48 hours.

## 1. Purpose test: is there a legitimate interest?
Yes. Two interests:
- **Fair leaderboards.** Without it, a player can play the daily in a private window as a guest (each answer is shown after each question) and then post a perfect score on their real account. Fair competition is the core of the game, and other players expect it. UK GDPR Recital 47 recognises preventing fraud as a legitimate interest.
- **Account security.** Limiting sign-in attempts and new accounts from one connection stops PIN guessing and mass fake accounts.

## 2. Necessity test: is this the least intrusive way?
- Alternatives considered: requiring email (dropped deliberately to collect less data); device fingerprinting (more intrusive, and needs consent under PECR); doing nothing (cheating stays easy). A short-lived, scrambled network tag is the least intrusive option that works.
- Minimised: the raw IP address is never stored; the daily secret means a tag can't be linked to the next day; nothing is read from the device; 48-hour retention.

## 3. Balancing test: do players' interests override ours?
- The data is low-risk: it can't be reversed into an address, it can't track anyone over time, and it's never shown to anyone.
- Players would reasonably expect basic anti-cheat and sign-in protection in a game with public leaderboards.
- Impact if it misfires: an honest player on shared wifi (where a guest played first) has that day's score left off the public Daily board only. It still counts for stats, streaks, friends and leagues, and the game explains why.
- Children: no profiling, no marketing, no tracking across days, so it fits the Children's Code.

**Conclusion:** the interest is legitimate, the processing is necessary and proportionate, and players' rights are protected. Players are told in the privacy notice and can object by emailing privacy@playdialin.com.

**Reviewed:** 21 November 2026, by Charlie Hilton-West and James Alden.
