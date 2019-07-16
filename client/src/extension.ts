/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { workspace, ExtensionContext, OutputChannel, window, languages, SnippetString, commands, TextEdit } from 'vscode';
import AureliaCliCommands from './aureliaCLICommands';
import { RelatedFiles } from './relatedFiles';
import { registerPreview } from './Preview/Register';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient';

let client: LanguageClient;
let outputChannel: OutputChannel;

export function activate(context: ExtensionContext) {
	// Create default output channel
  outputChannel = window.createOutputChannel('aurelia');
  context.subscriptions.push(outputChannel);

  // Register CLI commands
  context.subscriptions.push(AureliaCliCommands.registerCommands(outputChannel));
  context.subscriptions.push(new RelatedFiles());

  // Register Code Actions
  const edit = (uri: string, documentVersion: number, edits: TextEdit[]) =>
  {
    let textEditor = window.activeTextEditor;
    if (textEditor && textEditor.document.uri.toString() === uri) {
      textEditor.edit(mutator => {
        for(let edit of edits) {
          mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
        }
      }).then((success) => {
        window.activeTextEditor.document.save();
        if (!success) {
          window.showErrorMessage('Failed to apply Aurelia code fixes to the document. Please consider opening an issue with steps to reproduce.');
        }
      });
    }
  };
  context.subscriptions.push(commands.registerCommand('aurelia-attribute-invalid-case', edit));
  context.subscriptions.push(commands.registerCommand('aurelia-binding-one-way-deprecated', edit));

  console.log("TCL: activate -> activate", activate)
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
    diagnosticCollectionName: 'Aurelia',
    initializationOptions: {},
    documentSelector: ['html'],
    synchronize: {
      configurationSection: ['aurelia'],
    },
	};

	// Create the language client and start the client.
  client = new LanguageClient(
		'html',
		'Aurelia',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
