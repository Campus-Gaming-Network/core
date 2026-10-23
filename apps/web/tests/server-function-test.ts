/** Execute application validators and handlers without the RPC transport. */
export function serverFunctionBuilder<TInput, TData>(
  validate: (input: TInput) => TData,
) {
  return {
    validator<TNextInput, TNextData>(
      validator:
        | ((input: TNextInput) => TNextData)
        | { parse: (input: TNextInput) => TNextData },
    ) {
      return serverFunctionBuilder(
        typeof validator === "function"
          ? validator
          : (input: TNextInput) => validator.parse(input),
      );
    },
    handler<TResult>(handler: (context: { data: TData }) => TResult) {
      return (options?: { data: TInput }) =>
        handler({ data: validate(options?.data as TInput) });
    },
  };
}
