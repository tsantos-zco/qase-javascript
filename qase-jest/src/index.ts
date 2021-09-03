/* eslint-disable no-console,@typescript-eslint/no-non-null-assertion */
import { AggregatedResult, Context, Reporter, ReporterOnStartOptions, Test, TestResult } from '@jest/reporters';
import { ResultCreate, ResultCreated, ResultStatus, RunCreate, RunCreated } from 'qaseio/dist/src/models';
import { AssertionResult } from '@jest/types/build/TestResult';
import { QaseApi } from 'qaseio';
import chalk from 'chalk';

enum Envs {
    report = 'QASE_REPORT',
    apiToken = 'QASE_API_TOKEN',
    runId = 'QASE_RUN_ID',
    runName = 'QASE_RUN_NAME',
    runDescription = 'QASE_RUN_DESCRIPTION',
    runComplete = 'QASE_RUN_COMPLETE',
}

const Statuses = {
    passed: ResultStatus.PASSED,
    failed: ResultStatus.FAILED,
    skipped: ResultStatus.SKIPPED,
    pending: ResultStatus.SKIPPED,
    disabled: ResultStatus.BLOCKED,
};

interface QaseOptions {
    apiToken: string;
    projectCode: string;
    runId?: string;
    runPrefix?: string;
    logging?: boolean;
    runComplete?: boolean;
}

class QaseReporter implements Reporter {
    private api: QaseApi;
    private pending: Array<(runId: string | number) => void> = [];
    private results: Array<{test: AssertionResult; result: ResultCreated}> = [];
    private shouldPublish = 0;
    private options: QaseOptions;
    private runId?: number | string;

    public constructor(_: Record<string, unknown>, _options: QaseOptions ) {
        this.options = _options;
        this.options.runComplete = this.options.runComplete ||
            (this.getEnv(Envs.runComplete) ? true:'' !== '') || false;
        this.api = new QaseApi(this.options.apiToken || this.getEnv(Envs.apiToken) || '');

        if (!this.getEnv(Envs.report)) {
            return;
        }

        this.log(chalk`{yellow Current PID: ${process.pid}}`);
    }

    public onRunStart(results: AggregatedResult, options: ReporterOnStartOptions): void {
        this.checkProject(
            this.options.projectCode,
            (prjExists) => {
                if (prjExists) {
                    this.log(chalk`{green Project ${this.options.projectCode} exists}`);
                    if (this.getEnv(Envs.runId) || this.options.runId) {
                        this.saveRunId(this.getEnv(Envs.runId) || this.options.runId);
                        this.checkRun(
                            this.runId,
                            (runExists: boolean) => {
                                const run = this.runId as unknown as string;
                                if (runExists) {
                                    this.log(chalk`{green Using run ${run} to publish test results}`);
                                } else {
                                    this.log(chalk`{red Run ${run} does not exist}`);
                                }
                            }
                        );
                    } else if (!this.runId) {
                        this.createRun(
                            this.getEnv(Envs.runName),
                            this.getEnv(Envs.runDescription),
                            (created) => {
                                if (created) {
                                    this.saveRunId(created.id);
                                    process.env.QASE_RUN_ID = created.id.toString();
                                    this.log(chalk`{green Using run ${this.runId} to publish test results}`);
                                } else {
                                    this.log(chalk`{red Could not create run in project ${this.options.projectCode}}`);
                                }
                            }
                        );
                    }
                } else {
                    this.log(chalk`{red Project ${this.options.projectCode} does not exist}`);
                }
            }
        );
    }

    public onTestResult(test: Test, testResult: TestResult, aggregatedResult: AggregatedResult): void {
        testResult.testResults.map(((value) => {
            this.publishCaseResult(value);
        }));
    }

    public onRunComplete(contexts: Set<Context>, results: AggregatedResult): void {
        if (this.results.length === 0 && this.shouldPublish === 0) {
            this.log('No testcases were matched. Ensure that your tests are declared correctly.');
        }

        if (this.runId && this.shouldPublish !== 0 && this.options.runComplete) {
            this.log(
                chalk`{blue Waiting for 30 seconds to publish pending results}`
            );
            const endTime = Date.now() + 30e3;

            const interval = setInterval(() => {
                if (this.shouldPublish === 0) {
                    this.api.runs.complete(this.options.projectCode, this.runId!)
                        .then(() => this.log(chalk`{green Run ${this.runId} completed}`))
                        .catch((err) => this.log(`Error on completing run ${err as string}`));
                    if (this.runId && this.shouldPublish !== 0) {
                        this.log(
                            chalk`{red Could not send all results for 30 seconds after run. Please contact Qase Team.}`
                        );
                    }
                    clearInterval(interval);
                } else if ((Date.now() > endTime)) {
                    clearInterval(interval);
                }
            }, 200);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    public getLastError(): void {}

    private log(message?: any, ...optionalParams: any[]) {
        if (this.options.logging){
            console.log(chalk`{bold {blue qase:}} ${message}`, ...optionalParams);
        }
    }

    private getEnv(name: Envs) {
        return process.env[name];
    }

    private getCaseId(test: AssertionResult): number[] {
        const regexp = /(\(Qase ID: ([\d,]+)\))/;
        const results = regexp.exec(test.title);
        if (results && results.length === 3) {
            return results[2].split(',').map((value) => Number.parseInt(value, 10));
        }
        return [];
    }

    private logTestItem(test: AssertionResult) {
        const map = {
            failed: chalk`{red Test ${test.title} ${test.status}}`,
            passed: chalk`{green Test ${test.title} ${test.status}}`,
            skipped: chalk`{blueBright Test ${test.title} ${test.status}}`,
            pending: chalk`{blueBright Test ${test.title} ${test.status}}`,
            disabled: chalk`{gray Test ${test.title} ${test.status}}`,
        };
        if (test.status) {
            this.log(map[test.status]);
        }
    }

    private checkProject(projectCode: string, cb: (exists: boolean) => void) {
        this.api.projects.exists(projectCode)
            .then(cb)
            .catch((err) => {
                this.log(err);
            });
    }

    private createRun(
        name: string | undefined, description: string | undefined, cb: (created: RunCreated | undefined) => void
    ) {
        this.api.runs.create(
            this.options.projectCode,
            new RunCreate(
                name || `Automated run ${new Date().toISOString()}`,
                [],
                {description: description || 'Jest automated run'}
            )
        )
            .then((res) => res.data)
            .then(cb)
            .catch((err) => {
                this.log(`Error on creating run ${err as string}`);
            });
    }

    private checkRun(runId: string | number | undefined, cb: (exists: boolean) => void) {
        if (runId !== undefined) {
            this.api.runs.exists(this.options.projectCode, runId)
                .then(cb)
                .catch((err) => {
                    this.log(`Error on checking run ${err as string}`);
                });
        } else {
            cb(false);
        }
    }

    private saveRunId(runId?: string | number) {
        this.runId = runId;
        if (this.runId) {
            while (this.pending.length) {
                this.log(`Number of pending: ${this.pending.length}`);
                const cb = this.pending.shift();
                if (cb) {
                    cb(this.runId);
                }
            }
        }
    }

    private publishCaseResult(test: AssertionResult){
        this.logTestItem(test);

        const caseIds = this.getCaseId(test);
        caseIds.forEach((caseId) => {
            this.shouldPublish++;
            const publishTest = (runId: string | number) => {
                if (caseId) {
                    const add = caseIds.length > 1 ? chalk` {white For case ${caseId}}`:'';
                    this.log(
                        chalk`{gray Start publishing: ${test.title}}${add}`
                    );
                    test.failureMessages = test.failureMessages.map((value) => value.replace(/\u001b\[.*?m/g, ''));
                    this.api.results.create(this.options.projectCode, runId, new ResultCreate(
                        caseId,
                        Statuses[test.status],
                        {
                            time: test.duration!,
                            stacktrace: test.failureMessages.join('\n'),
                            comment: test.failureMessages.length > 0 ? test.failureMessages.map(
                                (value) => value.split('\n')[0]
                            ).join('\n'):undefined,
                        }
                    ))
                        .then((res) => {
                            this.results.push({test, result: res.data});
                            this.log(chalk`{gray Result published: ${test.title} ${res.data.hash}}${add}`);
                            this.shouldPublish--;
                        })
                        .catch((err) => {
                            this.log(err);
                            this.shouldPublish--;
                        });
                }
            };

            if (this.runId) {
                publishTest(this.runId);
            } else {
                this.pending.push(publishTest);
            }
        });
    }
}

export = QaseReporter;
