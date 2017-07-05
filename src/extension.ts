"use strict";

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

class QmkMapperConfiguration {
    public static getCurrentConfig() {
        return new QmkMapperConfiguration();
    }

    public readonly _previewUrlPrefix: string;

    private constructor() {
        const configRoot = vscode.workspace.getConfiguration("qmkmapper");
        this._previewUrlPrefix = configRoot.get<string>("_previewUrlPrefix", "");
    }
}

export function activate(context: vscode.ExtensionContext) {
    let previewUri = vscode.Uri.parse("qmkmapper-vsc://preview");
    let config = QmkMapperConfiguration.getCurrentConfig();
    let avoidResendCycleKeymapText = "";
    let throttleTimeout: NodeJS.Timer = null;

    class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
        constructor(public uri: vscode.Uri) {
            console.log("created a new preview", uri.toString());
            context.subscriptions.push(
                vscode.workspace.onDidChangeTextDocument(event => {
                    if (event.document.uri.toString() === uri.toString()) {
                        sendKeymapToPreview(event.document);
                    }
                })
            );

            context.subscriptions.push(
                vscode.workspace.onDidOpenTextDocument(document => {
                    if (document.uri.toString() === uri.toString()) {
                        console.log("resending a document as opened");
                        sendKeymapToPreview(document);
                    }
                })
            );

            context.subscriptions.push(
                vscode.workspace.onDidCloseTextDocument(document => {
                    if (document.uri.toString() === uri.toString()) {
                        sendKeymapToPreview("");
                    }
                })
            );
        }

        public provideTextDocumentContent(): string | Thenable<string> {
            return new Promise(resolve => {
                let indexFile = context.asAbsolutePath("out/qmkmapper/index.html");
                let urlPrefix =
                    vscode.Uri
                        .file(context.asAbsolutePath(path.join("out", "qmkmapper")))
                        .toString() + "/";

                if (config._previewUrlPrefix) {
                    urlPrefix = config._previewUrlPrefix;
                }

                fs.readFile(indexFile, "UTF-8", (err, data) => {
                    data = data.replace(
                        "//extension-settings",
                        'window["VSC_MODE"] = true;' +
                            'window["VSC_URI"] = "' +
                            decodeURIComponent(this.uri.toString()) +
                            '";'
                    );
                    data = data.replace(/src="/g, 'src="' + urlPrefix);
                    data = data.replace(/href="/g, 'href="' + urlPrefix);
                    resolve(data);
                });
            });
        }
    }
    const sendToPreview = (data: any) => {
        return vscode.commands.executeCommand(
            "_workbench.htmlPreview.postMessage",
            previewUri,
            data
        );
    };

    const sendKeymapToPreview = (document: vscode.TextDocument | string, init: boolean = false) => {
        if (throttleTimeout) {
            clearTimeout(throttleTimeout);
        }
        throttleTimeout = setTimeout(() => {
            let keymap = typeof document === "object" ? document.getText() : document;
            if (keymap !== avoidResendCycleKeymapText || init) {
                avoidResendCycleKeymapText = keymap;
                sendToPreview({
                    command: "setKeymap",
                    keymap,
                });
            }
        }, init ? 0 : 1000); // Throttle time must be long enough so that held key does not fail
    };

    // Recieved messages
    context.subscriptions.push(
        vscode.commands.registerCommand("_qmkmapper.logging", (payload: any) => {
            if ("development" === process.env.NODE_ENV) {
                console.log("preview log: ", payload);
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "_qmkmapper.connectedPreview",
            (payload: { uri: string }) => {
                vscode.workspace.openTextDocument(vscode.Uri.parse(payload.uri)).then(f => {
                    sendKeymapToPreview(f, true);
                });
            }
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "_qmkmapper.keymapFromPreview",
            (payload: { uri: string; keymap: string }) => {
                avoidResendCycleKeymapText = payload.keymap;
                let uri = vscode.Uri.parse(payload.uri);
                vscode.workspace.openTextDocument(uri).then(doc => {
                    if (doc.getText() === payload.keymap) {
                        return;
                    }
                    let edit = new vscode.WorkspaceEdit();
                    const lastLine = doc.lineAt(doc.lineCount - 2);
                    const start = new vscode.Position(0, 0);
                    const end = new vscode.Position(doc.lineCount - 1, lastLine.text.length);
                    edit.replace(uri, new vscode.Range(start, end), payload.keymap);
                    vscode.workspace.applyEdit(edit);
                });
            }
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("_qmkmapper.save", (payload: { uri: string }) => {
            let uri = vscode.Uri.parse(payload.uri);
            console.log("save", uri);
            vscode.workspace.openTextDocument(uri).then(doc => {
                console.log("did save", uri);
                doc.save();
            });
        })
    );

    // Opens the preview
    context.subscriptions.push(
        vscode.commands.registerCommand("qmkmapper.showQmkMapperKeymapPreview", () => {
            if (!vscode.window.activeTextEditor) {
                // TODO: Throw error that active editor must be keymap.c?
                return;
            }
            let provider = new TextDocumentContentProvider(
                vscode.window.activeTextEditor.document.uri
            );
            context.subscriptions.push(
                vscode.workspace.registerTextDocumentContentProvider("qmkmapper-vsc", provider)
            );

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
        })
    );
}
