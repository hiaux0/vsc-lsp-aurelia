/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import 'reflect-metadata';
import {
	createConnection,
	TextDocuments,
	TextDocument,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	CompletionList,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams
} from 'vscode-languageserver';
import { MarkedString } from 'vscode-languageserver';

import { Container } from 'aurelia-dependency-injection';
import CompletionItemFactory from './CompletionItemFactory';
import ElementLibrary from './Completions/Library/_elementLibrary';
import AureliaSettings from './AureliaSettings';

import ProcessFiles from './FileParser/ProcessFiles';

import { HtmlValidator } from './Validations/HtmlValidator';
import { HtmlInvalidCaseCodeAction } from './CodeActions/HtmlInvalidCaseCodeAction';
import { OneWayBindingDeprecatedCodeAction } from './CodeActions/OneWayBindingDeprecatedCodeAction';

import * as ts from 'typescript';
import { AureliaApplication } from './FileParser/Model/AureliaApplication';
import { normalizePath } from './Util/NormalizePath';
import { connect } from 'net';

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);
console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);
console.log('hello')

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
documents.listen(connection);

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

// Setup Aurelia dependency injection
const globalContainer = new Container();
const completionItemFactory = <CompletionItemFactory> globalContainer.get(CompletionItemFactory);
const aureliaApplication = <AureliaApplication> globalContainer.get(AureliaApplication);
const settings = <AureliaSettings> globalContainer.get(AureliaSettings);

connection.onInitialize((params: InitializeParams) => {
	let capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	return {
		capabilities: {
			completionProvider: { resolveProvider: false, triggerCharacters: ['<', ' ', '.', '[', '"', '\''] },
      codeActionProvider: true,
			textDocumentSync: documents.syncKind,
			// Tell the client that the server supports code completion
			// completionProvider: {
			// 	resolveProvider: true
			// }
		}
	};
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

const codeActions = [
  new HtmlInvalidCaseCodeAction(),
  new OneWayBindingDeprecatedCodeAction()
];
connection.onCodeAction(async codeActionParams => {
  const diagnostics = codeActionParams.context.diagnostics;
  const document = documents.get(codeActionParams.textDocument.uri);
  if (!document)  return;

  const commands = [];
  for (const diagnostic of diagnostics) {
    const action = codeActions.find(i => i.name == diagnostic.code);
    if (action) {
      commands.push(await action.commands(diagnostic, document));
    }
  }
  return commands;
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(async change => {
	console.log("TCL: onDidChangeConfiguration")
	settings.quote = change.settings.aurelia.autocomplete.quotes === 'single' ? '\'' : '"';
  settings.validation = change.settings.aurelia.validation;
  settings.bindings.data = change.settings.aurelia.autocomplete.bindings.data;
	settings.featureToggles = change.settings.aurelia.featureToggles;

	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
  await featureToggles(settings.featureToggles);

});

// Setup Validation
const validator = <HtmlValidator> globalContainer.get(HtmlValidator);
documents.onDidChangeContent(async change => {
  const diagnostics = await validator.doValidation(change.document);
  connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

// Lisen for completion requests
connection.onCompletion(async (textDocumentPosition) => {
  let document = documents.get(textDocumentPosition.textDocument.uri);
  if (!document) return;

  let text = document.getText();
  let offset = document.offsetAt(textDocumentPosition.position);
  let triggerCharacter = text.substring(offset - 1, offset);
  let position = textDocumentPosition.position;
  return CompletionList.create(await completionItemFactory.create(triggerCharacter, position, text, offset, textDocumentPosition.textDocument.uri), false);
});

connection.onRequest('aurelia-view-information', (filePath: string) => {
  return aureliaApplication.components.find(doc => doc.paths.indexOf(normalizePath(filePath)) > -1);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	console.log("TCL: validateTextDocument")
	console.log("TCL: textDocument", textDocument)
	// In this simple example we get the settings for every validate run.
	let settings = await getDocumentSettings(textDocument.uri);

	// The validator creates diagnostics for all uppercase words length 2 and more
	let text = textDocument.getText();
	let pattern = /\b[A-Z]{2,}\b/g;
	let m: RegExpExecArray | null;

	let problems = 0;
	let diagnostics: Diagnostic[] = [];
	while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
		problems++;
		let diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Warning,
			range: {
				start: textDocument.positionAt(m.index),
				end: textDocument.positionAt(m.index + m[0].length)
			},
			message: `${m[0]} is all uppercase.`,
			source: 'ex'
		};
		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Spelling matters'
				},
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Particularly for names'
				}
			];
		}
		diagnostics.push(diagnostic);
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		return [
			{
				label: 'TypeScript',
				kind: CompletionItemKind.Text,
				data: 1
			},
			{
				label: 'JavaScript',
				kind: CompletionItemKind.Text,
				data: 2
			}
		];
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (item.data === 1) {
			item.detail = 'TypeScript details';
			item.documentation = 'TypeScript documentation';
		} else if (item.data === 2) {
			item.detail = 'JavaScript details';
			item.documentation = 'JavaScript documentation';
		}
		return item;
	}
);


connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`>>>>> ${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`>>>> ${params.textDocument.uri} closed.`);
});


// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();

async function featureToggles(featureToggles: {}) {
  if (settings.featureToggles.smartAutocomplete) {
    console.log('smart auto complete init');
    try {
      let fileProcessor = new ProcessFiles();
      await fileProcessor.processPath();
      aureliaApplication.components = fileProcessor.components;
    } catch (ex) {
      console.log('------------- FILE PROCESSOR ERROR ---------------------');
      console.log(JSON.stringify(ex));
    }
  }
}
