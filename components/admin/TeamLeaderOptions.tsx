import { TEAM_LEADER_GROUP_LABELS, groupTeamLeadersByKind, type KindedTeamLeader } from "@/lib/teamLeaderKind";

/** The <option>s of a Team Leader dropdown. Real team leaders come first; a supervisor's direct team (the row that holds
 *  the reps of a principal with no team leader) is grouped apart under its own heading so it is never mistaken for a
 *  team leader; leavers are left out unless `includeFormer` is set (merging duplicates needs them). */
export function TeamLeaderOptions<T extends KindedTeamLeader & { id: string; name: string }>({
  teamLeaders,
  includeFormer = false,
  labelFor,
}: {
  teamLeaders: T[];
  includeFormer?: boolean;
  labelFor?: (teamLeader: T) => string;
}) {
  const grouped = groupTeamLeadersByKind(teamLeaders, { includeFormer });
  const options = (list: T[]) =>
    list.map((tl) => (
      <option key={tl.id} value={tl.id}>
        {labelFor ? labelFor(tl) : tl.name}
      </option>
    ));
  const nonEmpty = (["teamLeaders", "directTeams", "former"] as const).filter((key) => grouped[key].length > 0);
  if (nonEmpty.length <= 1) return <>{nonEmpty.map((key) => options(grouped[key]))}</>;
  return (
    <>
      {nonEmpty.map((key) => (
        <optgroup key={key} label={TEAM_LEADER_GROUP_LABELS[key]}>
          {options(grouped[key])}
        </optgroup>
      ))}
    </>
  );
}
