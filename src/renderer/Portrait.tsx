import type { Teammate } from "../shared/contracts";
import { portraitOptions, type PortraitId } from "../shared/portrait-library";
import maya from "../../assets/team-portrait-maya.png";
import ellis from "../../assets/team-portrait-ellis.png";
import jun from "../../assets/team-portrait-jun.png";
import nadine from "../../assets/team-portrait-nadine.png";
import rafi from "../../assets/team-portrait-rafi.png";
import sloane from "../../assets/team-portrait-sloane.png";
import tessa from "../../assets/team-portrait-tessa.png";
import meryl from "../../assets/team-portrait-meryl.png";
import adrian from "../../assets/team-portrait-adrian.png";
import carmen from "../../assets/team-portrait-carmen.png";
import kiran from "../../assets/team-portrait-kiran.png";
import jess from "../../assets/team-portrait-jess.png";
import coordinator from "../../assets/team-portrait-coordinator-v1.png";
import youngTester from "../../assets/team-portrait-young-1-v1.png";
import research from "../../assets/team-portrait-research-v1.png";
import reliability from "../../assets/team-portrait-reliability-v1.png";

const assets = {
  maya,
  ellis,
  jun,
  nadine,
  rafi,
  sloane,
  tessa,
  meryl,
  adrian,
  carmen,
  kiran,
  jess,
  coordinator,
  "young-tester": youngTester,
  research,
  reliability,
};

export function portraitStyle(id: PortraitId) {
  const option =
    portraitOptions.find((item) => item.id === id) || portraitOptions[0];
  return {
    backgroundImage: `url(${assets[option.asset]})`,
    backgroundPosition: "center top",
    backgroundSize: "cover",
  };
}

export function Portrait({
  person,
  portraitId = person.portraitId,
  className = "",
}: {
  person: Teammate;
  portraitId?: PortraitId;
  className?: string;
}) {
  const option =
    portraitOptions.find((item) => item.id === portraitId) ||
    portraitOptions[0];
  return (
    <span
      role="img"
      aria-label={`${person.name} portrait: ${option.label}`}
      className={`portrait ${className}`}
      style={portraitStyle(option.id)}
    />
  );
}
