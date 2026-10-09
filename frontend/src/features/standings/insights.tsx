import type { StickerShape } from "@gruberb/fun-ui";
import { Crosshair, FormChip, LogoTile, Sticker, usePopoverHover } from "@gruberb/fun-ui";
import type { PopoverTeam } from "../../components/match-popover";
import { MatchPopover } from "../../components/match-popover";
import { PlayerPortrait } from "../../components/player-identity";
import type { InsightCard as InsightCardData, InsightFact, InsightSubject, InsightVisual as InsightVisualData } from "../../types/models";
import { formOutcome } from "../../utils/football";
import { initialsOf } from "../../utils/format";

export function InsightCards({ cards, onTeam, onPlayer }: { cards: InsightCardData[]; onTeam: (id: string) => void; onPlayer: (id: string) => void }) {
  return (
    <section className="insight-band fui-grid-paper" aria-label="Spieltag auf einen Blick">
      {cards.map((card) => (
        <article className="insight-card" key={card.id}>
          <header><h2>{card.title}</h2><span>{card.category}</span></header>
          <dl>
            <div className="insight-beside-sticker"><dt>Frage</dt><dd className="insight-question">{card.question}</dd></div>
            <div className="insight-beside-sticker"><dt>Ergebnis</dt><dd className="insight-answer">
              {card.subject && <SubjectMedia subject={card.subject} onTeam={onTeam} onPlayer={onPlayer} />}
              <span>{card.answer}</span>
            </dd></div>
            <div><dt>{card.detailLabel}</dt><dd>{card.detail}</dd></div>
            <div><dt>{card.visual.label}</dt><dd><InsightVisual visual={card.visual} /></dd></div>
          </dl>
          <Sticker shape={stickerShapes[card.kind] ?? "trophy"} />
          <Crosshair />
        </article>
      ))}
    </section>
  );
}

function InsightVisual({ visual }: { visual: InsightVisualData }) {
  if (visual.type === "results") {
    return <>
      {visual.summary && <p className="insight-summary">{visual.summary}</p>}
      <ol className="insight-rows">{visual.rows.map((row) => (
        <li key={row.round}><span>ST {row.round}</span><FormChip outcome={formOutcome[row.outcome]}>{row.outcome}</FormChip><b>{row.score}</b><span>{row.home ? "gegen" : "bei"} {row.opponent}</span></li>
      ))}</ol>
    </>;
  }
  if (visual.type === "roundValues") {
    return <>
      {visual.summary && <p className="insight-summary">{visual.summary}</p>}
      <ol className="insight-rows">{visual.rows.map((row) => (
        <li key={row.round}><span>ST {row.round}</span><b>{row.value}</b><small>{visual.unit}</small><span>{row.opponent ? `gegen ${row.opponent}` : ""}</span></li>
      ))}</ol>
    </>;
  }
  if (visual.type !== "outcomes") return null;
  return <span className="insight-outcomes">{visual.values.map((value, index) => <OutcomeSquare key={index} value={value} match={visual.matches?.[index]} />)}</span>;
}

const outcomeName = { H: "Heimsieg", U: "Unentschieden", A: "Auswärtssieg" } as const;

function OutcomeSquare({ value, match }: { value: "H" | "U" | "A"; match?: { home: InsightSubject; away: InsightSubject; score: string } }) {
  const hover = usePopoverHover<HTMLElement>();
  const team = (subject: InsightSubject): PopoverTeam => ({ name: subject.name, code: subject.short ?? initialsOf(subject.name), logoUrl: subject.imageUrl ?? null });
  if (!match) return <i className={`outcome-${value.toLowerCase()}`} title={outcomeName[value]}>{value}</i>;
  return (
    <i ref={hover.ref} className={`outcome-${value.toLowerCase()}`} tabIndex={0} aria-label={`${outcomeName[value]}: ${match.home.name} ${match.score} ${match.away.name}`} {...hover.handlers}>
      {value}
      <MatchPopover hover={hover} title={outcomeName[value]} status="Spiel des Spieltags" home={team(match.home)} away={team(match.away)} score={match.score} />
    </i>
  );
}

export function InsightFacts({ round, facts, onTeam, onPlayer }: { round: number; facts: InsightFact[]; onTeam: (id: string) => void; onPlayer: (id: string) => void }) {
  return (
    <section className="tabelle-block">
      <div className="section-copy"><p className="fui-kicker">Spieltag {round}</p><h2>Der Spieltag in Zahlen</h2></div>
      <div className="insight-facts">
        {facts.map((fact) => (
          <article className="insight-fact" key={fact.id}>
            <h3>{fact.title}</h3>
            <div className="insight-fact-value"><span className={fact.tone ? `tone-${fact.tone}` : undefined}>{fact.value}</span><small>{fact.context}</small></div>
            {fact.subjects && fact.subjects.length > 0 && <div className="insight-subjects">{fact.subjects.map((subject) => <SubjectMedia key={subject.id} subject={subject} onTeam={onTeam} onPlayer={onPlayer} />)}</div>}
            <p>{fact.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SubjectMedia({ subject, onTeam, onPlayer }: { subject: InsightSubject; onTeam: (id: string) => void; onPlayer: (id: string) => void }) {
  const isTeam = subject.kind === "team";
  const label = `${subject.name}: ${isTeam ? "Mannschaftsprofil" : "Spielerprofil"} öffnen`;
  return (
    <button className={`subject-media subject-${subject.kind}`} title={label} aria-label={label} onClick={() => (isTeam ? onTeam : onPlayer)(subject.id)}>
      {isTeam
        ? <LogoTile code={initialsOf(subject.name)} url={subject.imageUrl ?? null} />
        : <PlayerPortrait name={subject.name} url={subject.imageUrl ?? null} teamCode={initialsOf(subject.name)} teamLogoUrl={null} />}
    </button>
  );
}

const stickerShapes: Record<string, StickerShape> = { topPlayer: "ball", roundTopPlayer: "ball", roundGoals: "whistle", topScorer: "boot", value: "coin", form: "flame" };
