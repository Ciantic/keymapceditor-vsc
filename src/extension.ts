import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

class KeymapCEditorConfiguration {
    public static getCurrentConfig() {
        return new KeymapCEditorConfiguration();
    }

    private constructor() {
        const configRoot = vscode.workspace.getConfiguration("keymapceditor");
    }
}

let panel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext) {
    let config = KeymapCEditorConfiguration.getCurrentConfig();
    let avoidResendCycleKeymapText = "";
    let throttleTimeout: NodeJS.Timer = null;

    const getWebViewHtml = (uri: vscode.Uri): Thenable<string> => {
        return new Promise((res, rej) => {
            let indexFile = context.asAbsolutePath("out/keymapceditor/index.html");
            let urlPrefixUri = vscode.Uri.file(
                path.join(context.extensionPath, "out", "keymapceditor")
            );

            let urlPrefix = urlPrefixUri.with({ scheme: "vscode-resource" }).toString() + "/";

            fs.readFile(indexFile, "UTF-8", (err, data) => {
                if (err) {
                    rej(err);
                    return;
                }
                data = data.replace(
                    "//extension-settings",
                    'window["VSC_MODE"] = true;' +
                        'window["VSC_URI"] = "' +
                        uri.toString() +
                        // decodeURIComponent(this.uri.toString()) + ###############
                        '";'
                );
                data = data.replace(/src="/g, 'src="' + urlPrefix);
                data = data.replace(/href="/g, 'href="' + urlPrefix);
                res(data);
            });
        });
    };

    const sendToPreview = (uri: vscode.Uri, data: any) => {
        if (!panel) {
            return;
        }
        return panel.webview.postMessage({
            previewUri: uri.toString(),
            ...data,
        });
    };

    const sendKeymapToPreview = (
        uri: vscode.Uri,
        document: vscode.TextDocument | string,
        init: boolean = false
    ) => {
        if (throttleTimeout) {
            clearTimeout(throttleTimeout);
        }
        throttleTimeout = setTimeout(
            () => {
                let keymap = typeof document === "object" ? document.getText() : document;
                if (keymap !== avoidResendCycleKeymapText || init) {
                    avoidResendCycleKeymapText = keymap;
                    sendToPreview(uri, {
                        command: "setKeymap",
                        keymap,
                    });
                }
            },
            init ? 0 : 1000
        ); // Throttle time must be long enough so that held key does not fail
    };

    // Opens the preview
    context.subscriptions.push(
        vscode.commands.registerCommand("keymapceditor.showKeymapCEditor", () => {
            if (!vscode.window.activeTextEditor) {
                // TODO: Throw error that active editor must be keymap.c?
                return;
            }
            if (panel) {
                panel.reveal(vscode.ViewColumn.Two);
                return;
            }
            let uri = vscode.window.activeTextEditor.document.uri;

            context.subscriptions.push(
                vscode.workspace.onDidChangeTextDocument(event => {
                    if (event.document.uri.toString() === uri.toString()) {
                        sendKeymapToPreview(uri, event.document);
                    }
                })
            );

            context.subscriptions.push(
                vscode.workspace.onDidOpenTextDocument(document => {
                    if (document.uri.toString() === uri.toString()) {
                        sendKeymapToPreview(uri, document);
                    }
                })
            );

            context.subscriptions.push(
                vscode.workspace.onDidCloseTextDocument(document => {
                    if (document.uri.toString() === uri.toString()) {
                        // TODO: Should we inform the view somehow?
                        // sendKeymapToPreview(uri, "");
                    }
                })
            );

            panel = vscode.window.createWebviewPanel(
                "keymapCEditor",
                "KeymapCEditor keymap.c editor",
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.file(path.join(context.extensionPath, "out/keymapceditor")),
                    ],
                }
            );
            panel.webview.onDidReceiveMessage(
                (
                    msg:
                        | {
                              command: "_keymapceditor.connectedPreview";
                              uri: string;
                          }
                        | {
                              command: "_keymapceditor.keymapFromPreview";
                              uri: string;
                              keymap: string;
                          }
                ) => {
                    if (msg.command == "_keymapceditor.connectedPreview") {
                        vscode.workspace.openTextDocument(vscode.Uri.parse(msg.uri)).then(f => {
                            sendKeymapToPreview(uri, f, true);
                        });
                    } else if (msg.command == "_keymapceditor.keymapFromPreview") {
                        avoidResendCycleKeymapText = msg.keymap;
                        let uri = vscode.Uri.parse(msg.uri);
                        vscode.workspace.openTextDocument(uri).then(doc => {
                            let text = doc.getText();
                            if (text === msg.keymap) {
                                return;
                            }
                            let edit = new vscode.WorkspaceEdit();

                            // Replace all text, see https://stackoverflow.com/a/50875520
                            let invalidRange = new vscode.Range(0, 0, doc.lineCount, 0);
                            let fullRange = doc.validateRange(invalidRange);
                            edit.replace(uri, fullRange, msg.keymap);

                            vscode.workspace.applyEdit(edit);
                        });
                    }
                }
            );
            panel.onDidDispose(f => {
                panel = null;
            });
            getWebViewHtml(uri).then(r => {
                panel.webview.html = r;
            });
        })
    );
}
