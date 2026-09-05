export type FormState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export const initialFormState: FormState = {
  status: "idle",
  message: ""
};
