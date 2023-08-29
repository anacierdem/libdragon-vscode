import * as path from 'path';
import * as fs from 'fs';

import { load } from 'js-yaml';


const inputLanguage = load(
    fs.readFileSync(path.join(__dirname, '..', 'syntaxes', 'rsp.tmLanguage.template.yaml'), 'utf8')
) as any;

const variables = Object.assign({}, inputLanguage.variables);
const regex = /\{\{(.*?)\}\}/gm;
function substituteVariables(this: any, key: string, input: string) {
    if(typeof input === 'string') {
        console.log(`Substituting variables in ${key}: ${input}`)
        let output = input;
        let results;
        do {
            results = regex.exec(input);
            if(results) {
                for (let i = 1; i < results.length; i++) {
                    const variableName = results[i];
                    const variableValue = variables[variableName];
                    console.log(`Substituting ${variableName} with ${variableValue}`);
                    output = output.replace(new RegExp(`\\{\\{${variableName}\\}\\}`), variableValue);
                }
            }
        } while(results);
        // Mutate variables so that they can be used later
        if (this === inputLanguage.variables) {
            console.log(`Update vars ${key}: ${output}`)
            variables[key] = output;
        }
        return output.replace(/\s/g, "");
    } else {
        return input;
    }
}

fs.writeFileSync(
    path.join(__dirname, '..', 'syntaxes', 'rsp.tmLanguage.json'),
    JSON.stringify(inputLanguage, substituteVariables, '  ')
)