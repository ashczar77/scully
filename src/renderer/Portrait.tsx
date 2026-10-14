import type { Teammate } from "../shared/contracts";
import { portraitOptions, type PortraitId } from "../shared/portrait-library";
import atlas1 from "../../assets/team-portraits.png";
import atlas2 from "../../assets/team-portraits-2.png";
import atlas3 from "../../assets/team-portraits-3.png";
import atlas4 from "../../assets/team-portraits-4.png";
import coordinator from "../../assets/team-portrait-coordinator-v1.png";
import youngTester from "../../assets/team-portrait-young-1-v1.png";
import research from "../../assets/team-portrait-research-v1.png";
import reliability from "../../assets/team-portrait-reliability-v1.png";

const atlases = [atlas1, atlas2, atlas3, atlas4];
const assets = {
  coordinator,
  "young-tester": youngTester,
  research,
  reliability,
};

export function portraitStyle(id: PortraitId) {
  const option =
    portraitOptions.find((item) => item.id === id) || portraitOptions[0];
  return "asset" in option
    ? {
        backgroundImage: `url(${assets[option.asset]})`,
        backgroundPosition: "center top",
        backgroundSize: "cover",
      }
    : {
        backgroundImage: `url(${atlases[option.atlas]})`,
        backgroundPosition: `${option.column * 50}% top`,
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
