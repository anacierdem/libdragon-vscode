import * as path from 'path';
import * as fs from 'fs';

import { load } from 'js-yaml';

const rspLanguage = load(
  fs.readFileSync(
    path.join(__dirname, "..", "syntaxes", "mips.rsp.tmLanguage.template.yaml"),
    "utf8",
  ),
) as Record<string, any>;

const regex = /\{\{(.*?)\}\}/gm;
const substituteVariables = (inputLanguage: Record<string, any>) => {
  const variables = Object.assign({}, inputLanguage.variables);
  return function (this: any, key: string, input: string) {
    if (typeof input === "string") {
      console.log(`Substituting variables in ${key}: ${input}`);
      let output = input;
      let results;
      do {
        results = regex.exec(input);
        if (results) {
          for (let i = 1; i < results.length; i++) {
            const variableName = results[i];
            const variableValue = variables[variableName];
            console.log(`Substituting ${variableName} with ${variableValue}`);
            output = output.replace(
              new RegExp(`\\{\\{${variableName}\\}\\}`),
              variableValue,
            );
          }
        }
      } while (results);
      // Mutate variables so that they can be used later
      if (this === inputLanguage.variables) {
        console.log(`Update vars ${key}: ${output}`);
        variables[key] = output;
      }
      return output.replace(/\s/g, "");
    } else {
      return input;
    }
  };
};

fs.writeFileSync(
  path.join(__dirname, "..", "syntaxes", "mips.rsp.tmLanguage.json"),
  JSON.stringify(rspLanguage, substituteVariables(rspLanguage), "  "),
);

// Renaming just for convenience, we will soon mutate the object
const mipsLanguage = rspLanguage;
delete mipsLanguage.repository.not_impl_inst;
delete mipsLanguage.repository.instruction.captures;
mipsLanguage.scopeName = "source.mips";
fs.writeFileSync(
  path.join(__dirname, "..", "syntaxes", "mips.tmLanguage.json"),
  JSON.stringify(mipsLanguage, substituteVariables(mipsLanguage), "  "),
);