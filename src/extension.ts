import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

class KeymapCEditorConfiguration {
    public static getCurrentConfig() {
        return new KeymapCEditorConfiguration();
    }

    public readonly _previewUrlPrefix: string;

    private constructor() {
        const configRoot = vscode.workspace.getConfiguration("keymapceditor");
        this._previewUrlPrefix = configRoot.get<string>("_previewUrlPrefix", "");
    }
}

export function activate(context: vscode.ExtensionContext) {
    let previewUri = vscode.Uri.parse("keymapceditor-vsc://preview");
    let config = KeymapCEditorConfiguration.getCurrentConfig();
    let avoidResendCycleKeymapText = "";
    let throttleTimeout: NodeJS.Timer = null;

    class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
        constructor(public uri: vscode.Uri) {
            // this leaks when destroying TextDocumentContentProvider
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
                let indexFile = context.asAbsolutePath("out/keymapceditor/index.html");
                let urlPrefix =
                    vscode.Uri.file(
                        context.asAbsolutePath(path.join("out", "keymapceditor"))
                    ).toString() + "/";

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
        vscode.commands.registerCommand("_keymapceditor.logging", (payload: any) => {
            if ("development" === process.env.NODE_ENV) {
                console.log("preview log: ", payload);
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "_keymapceditor.connectedPreview",
            (payload: { uri: string }) => {
                vscode.workspace.openTextDocument(vscode.Uri.parse(payload.uri)).then(f => {
                    sendKeymapToPreview(f, true);
                });
            }
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "_keymapceditor.keymapFromPreview",
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
        vscode.commands.registerCommand("_keymapceditor.save", (payload: { uri: string }) => {
            let uri = vscode.Uri.parse(payload.uri);
            vscode.workspace.openTextDocument(uri).then(doc => {
                doc.save();
            });
        })
    );

    let provider: TextDocumentContentProvider | null = null;

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.uri.toString() === previewUri.toString()) {
                provider = null;
            }
        })
    );

    // Opens the preview
    context.subscriptions.push(
        vscode.commands.registerCommand("keymapceditor.showKeymapCEditor", () => {
            if (!vscode.window.activeTextEditor) {
                // TODO: Throw error that active editor must be keymap.c?
                return;
            }
            if (provider !== null) {
                // TODO: Throw error that there is already keymapceditor there
                return;
            }
            provider = new TextDocumentContentProvider(vscode.window.activeTextEditor.document.uri);
            context.subscriptions.push(
                vscode.workspace.registerTextDocumentContentProvider("keymapceditor-vsc", provider)
            );

            return vscode.commands
                .executeCommand(
                    "vscode.previewHtml",
                    previewUri,
                    vscode.ViewColumn.Two,
                    "KeymapCEditor keymap.c editor",
                    { allowScripts: true, allowSvgs: true }
                )
                .then(
                    success => { },
                    reason => {
                        vscode.window.showErrorMessage(reason);
                    }
                );
        })
    );
}
