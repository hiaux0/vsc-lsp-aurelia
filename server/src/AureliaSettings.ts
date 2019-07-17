import { CompletionItem } from 'vscode-languageserver';

export default class AureliaSettings {
  public quote: string = '"';
  public validation: boolean = true;
  public bindings: {
    data : CompletionItem[]
  } = {
    data: [],
  }

  public featureToggles = {
    smartAutocomplete : true
  }
}
