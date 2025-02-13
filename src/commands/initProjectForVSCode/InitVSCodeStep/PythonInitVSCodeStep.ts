/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { DebugConfiguration, TaskDefinition } from 'vscode';
import { extInstallCommand, extInstallTaskName, func, funcWatchProblemMatcher, gitignoreFileName, hostStartCommand, Platform, pythonVenvSetting } from "../../../constants";
import { pythonDebugConfig } from '../../../debug/PythonDebugProvider';
import { ext } from '../../../extensionVariables';
import { venvUtils } from '../../../utils/venvUtils';
import { IProjectWizardContext } from '../../createNewProject/IProjectWizardContext';
import { getExistingVenv } from '../../createNewProject/ProjectCreateStep/PythonProjectCreateStep';
import { ScriptInitVSCodeStep } from './ScriptInitVSCodeStep';

export class PythonInitVSCodeStep extends ScriptInitVSCodeStep {
    private _venvName: string | undefined;

    protected async executeCore(context: IProjectWizardContext): Promise<void> {
        await super.executeCore(context);

        this.settings.push({ key: 'scmDoBuildDuringDeployment', value: true });

        this._venvName = await getExistingVenv(context.projectPath);
        if (this._venvName) {
            this.settings.push({ key: pythonVenvSetting, value: this._venvName });
            await ensureVenvInFuncIgnore(context.projectPath, this._venvName);
        }

        const gitignoreLines: string[] = ['.python_packages', '__pycache__'];
        if (this._venvName) {
            gitignoreLines.push(this._venvName);
        }
        await ensureGitIgnoreContents(context.projectPath, gitignoreLines);
    }

    protected getDebugConfiguration(): DebugConfiguration {
        return pythonDebugConfig;
    }

    protected getTasks(): TaskDefinition[] {
        const pipInstallLabel: string = 'pipInstall';
        const dependsOn: string | undefined = this.requiresFuncExtensionsInstall ? extInstallTaskName : this._venvName ? pipInstallLabel : undefined;
        const tasks: TaskDefinition[] = [
            {
                type: func,
                command: hostStartCommand,
                problemMatcher: funcWatchProblemMatcher,
                isBackground: true,
                dependsOn
            }
        ];

        if (this._venvName) {
            if (this.requiresFuncExtensionsInstall) {
                tasks.push({
                    type: func,
                    command: extInstallCommand,
                    dependsOn: pipInstallLabel,
                    problemMatcher: []
                });
            }

            const venvSettingReference: string = `\${config:${ext.prefix}.${pythonVenvSetting}}`;

            function getPipInstallCommand(platform: NodeJS.Platform): string {
                return venvUtils.convertToVenvPythonCommand('pip install -r requirements.txt', venvSettingReference, platform);
            }

            tasks.push(
                {
                    label: pipInstallLabel,
                    type: 'shell',
                    osx: {
                        command: getPipInstallCommand(Platform.MacOS)
                    },
                    windows: {
                        command: getPipInstallCommand(Platform.Windows)
                    },
                    linux: {
                        command: getPipInstallCommand(Platform.Linux)
                    },
                    problemMatcher: []
                }
            );
        }

        return tasks;
    }

    protected getRecommendedExtensions(): string[] {
        return ['ms-python.python'];
    }
}

export async function ensureGitIgnoreContents(projectPath: string, lines: string[]): Promise<void> {
    // .gitignore is created by `func init`
    const gitignorePath: string = path.join(projectPath, gitignoreFileName);
    if (await fse.pathExists(gitignorePath)) {
        let writeFile: boolean = false;
        let gitignoreContents: string = (await fse.readFile(gitignorePath)).toString();

        for (const line of lines) {
            if (!gitignoreContents.includes(line)) {
                gitignoreContents = gitignoreContents.concat(`${os.EOL}${line}`);
                writeFile = true;
            }
        }

        if (writeFile) {
            await fse.writeFile(gitignorePath, gitignoreContents);
        }
    }
}

async function ensureVenvInFuncIgnore(projectPath: string, venvName: string): Promise<void> {
    const funcIgnorePath: string = path.join(projectPath, '.funcignore');
    let funcIgnoreContents: string | undefined;
    if (await fse.pathExists(funcIgnorePath)) {
        funcIgnoreContents = (await fse.readFile(funcIgnorePath)).toString();
        if (funcIgnoreContents && !funcIgnoreContents.includes(venvName)) {
            funcIgnoreContents = funcIgnoreContents.concat(`${os.EOL}${venvName}`);
        }
    }

    if (!funcIgnoreContents) {
        funcIgnoreContents = venvName;
    }

    await fse.writeFile(funcIgnorePath, funcIgnoreContents);
}
