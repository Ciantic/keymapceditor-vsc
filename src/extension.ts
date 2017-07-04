"use strict";

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
    let previewUri = vscode.Uri.parse("qmkmapper-vsc://preview");

    class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
        constructor(public uri: vscode.Uri) {
            context.subscriptions.push(
                vscode.workspace.onDidChangeTextDocument(event => {
                    if (event.document.uri === uri) {
                        let keymap = event.document.getText();
                        if (keymap !== avoidResendCycleKeymapText) {
                            sendKeymapToPreview(uri, keymap);
                        }
                    }
                })
            );
        }

        public provideTextDocumentContent(): string | Thenable<string> {
            return new Promise(resolve => {
                let indexFile = context.asAbsolutePath("out/qmkmapper/index.html");
                let urlStart = vscode.Uri.file(context.asAbsolutePath("out/qmkmapper/"));
                fs.readFile(indexFile, "utf8", (err, data) => {
                    data = data.replace(/src="/g, 'src="' + urlStart);
                    data = data.replace(/href="/g, 'href="' + urlStart);
                    resolve(data);
                });
            });
        }
    }

    const getUrl = (file: string) => {
        return vscode.Uri.file(context.asAbsolutePath(file)).toString();
    };

    let provider: TextDocumentContentProvider;

    let avoidResendCycleKeymapText = "";

    let disposable = vscode.commands.registerCommand("extension.showQmkMapperKeymapPreview", () => {
        if (!vscode.window.activeTextEditor) {
            // TODO: Throw error that active editor must be keymap.c?
            return;
        }
        provider = new TextDocumentContentProvider(vscode.window.activeTextEditor.document.uri);
        let registration = vscode.workspace.registerTextDocumentContentProvider(
            "qmkmapper-vsc",
            provider
        );
        context.subscriptions.push(registration);

        return vscode.commands
            .executeCommand(
                "vscode.previewHtml",
                previewUri,
                vscode.ViewColumn.Two,
                "QMKMapper keymap.c preview",
                { allowScripts: true, allowSvgs: true }
            )
            .then(
                success => {},
                reason => {
                    vscode.window.showErrorMessage(reason);
                }
            );
    });

    const sendToPreview = (data: any) => {
        return vscode.commands.executeCommand(
            "_workbench.htmlPreview.postMessage",
            previewUri,
            data
        );
    };

    let throttleTimeout: NodeJS.Timer = null;

    const sendKeymapToPreview = (documentUri: vscode.Uri, keymap: string) => {
        // Throttle assumes that documentUri does not change
        if (throttleTimeout) {
            clearTimeout(throttleTimeout);
        }
        throttleTimeout = setTimeout(() => {
            sendToPreview({
                command: "setKeymap",
                documentUri: documentUri.toString(),
                keymap,
            });
        }, 300);
    };

    // Recieved messages
    context.subscriptions.push(
        vscode.commands.registerCommand("_qmkmapper.logging", (payload: any) => {
            console.log("preview log: ", payload);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("_qmkmapper.connectedPreview", (payload: any) => {
            if (provider) {
                for (const editor of vscode.window.visibleTextEditors) {
                    if (editor.document.uri.toString() === provider.uri.toString()) {
                        sendKeymapToPreview(provider.uri, editor.document.getText());
                    }
                }
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "_qmkmapper.keymapFromPreview",
            (payload: { documentUri: string; keymap: string }) => {
                if (provider) {
                    for (const editor of vscode.window.visibleTextEditors) {
                        if (editor.document.uri.toString() === provider.uri.toString()) {
                            avoidResendCycleKeymapText = payload.keymap;
                            editor.edit(builder => {
                                const document = editor.document;
                                const lastLine = document.lineAt(document.lineCount - 2);
                                const start = new vscode.Position(0, 0);
                                const end = new vscode.Position(
                                    document.lineCount - 1,
                                    lastLine.text.length
                                );
                                builder.replace(new vscode.Range(start, end), payload.keymap);
                            });
                        }
                    }
                }
            }
        )
    );

    context.subscriptions.push(disposable);
}
