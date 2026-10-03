import { SchoolSearchSelect } from "../../components/school-search-select";
import type { EventFormSchoolDTO } from "./contracts.js";

export { NoScriptSchoolSearch } from "../../components/school-search-select";

type Props = {
  defaultSchoolID: string;
  defaultSchool?: EventFormSchoolDTO;
  initialQuery: string;
  initialSchools: EventFormSchoolDTO[];
  initialSearchFailed: boolean;
  describedBy?: string;
  invalid?: boolean;
};

export function EventSchoolPicker({ defaultSchoolID, ...props }: Props) {
  return (
    <SchoolSearchSelect
      {...props}
      className="event-school-picker"
      defaultValue={defaultSchoolID}
      emptyLabel="Choose a host school"
      label="Host school"
      name="host_school_id"
      required
      valueField="id"
    />
  );
}
